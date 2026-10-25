import type { LyricLine, Lyrics } from './contract';

export interface LyricsQuery {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationSec: number;
}

export interface LrclibRecord {
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface YtmLyrics {
  text: string;
  source: string;
}

export interface LyricsDeps {
  fetchJson: (url: string) => Promise<unknown>;
  ytm: (videoId: string) => Promise<YtmLyrics | null>;
}

export class LyricsError extends Error {
  override readonly name = 'LyricsError';
}

export const LRCLIB_BASE = 'https://lrclib.net/api';
export const SYNC_TOLERANCE_SEC = 2;
const MAX_LINES = 1000;
const MAX_LINE_CHARS = 500;
const INSTRUMENTAL_MARK = '♪';

const LEADING_TAG = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]/im;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;
const NOISE_WORDS =
  /\b(official|video|audio|lyrics?|visuali[sz]er|mv|m\/v|hd|hq|4k|explicit|clean|remaster(ed)?|color coded|from|soundtrack)\b/i;
const FEATURE = /\b(feat|ft|featuring)\b\.?/i;

function fractionMs(text: string | undefined): number {
  if (text === undefined || text === '') {
    return 0;
  }
  if (text.length === 1) {
    return Number(text) * 100;
  }
  if (text.length === 2) {
    return Number(text) * 10;
  }
  return Number(text.slice(0, 3));
}

export function parseLrc(source: string): LyricLine[] {
  const offsetMatch = OFFSET_TAG.exec(source);
  const offset = offsetMatch ? Number.parseInt(offsetMatch[1] ?? '0', 10) : 0;
  const lines: LyricLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    let rest = raw.trim();
    const stamps: number[] = [];
    let match = LEADING_TAG.exec(rest);
    while (match) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      stamps.push((minutes * 60 + seconds) * 1000 + fractionMs(match[3]));
      rest = rest.slice(match[0].length).trim();
      match = LEADING_TAG.exec(rest);
    }
    if (stamps.length === 0) {
      continue;
    }
    const cleaned = rest.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS);
    const text = cleaned === '' ? INSTRUMENTAL_MARK : cleaned;
    for (const stamp of stamps) {
      lines.push({ timeMs: Math.max(0, stamp - offset), text });
    }
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines.slice(0, MAX_LINES);
}

export function plainLines(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let blank = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(LEADING_TAG, '')
      .replace(WORD_TAG, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_LINE_CHARS);
    if (line === '') {
      if (!blank) {
        lines.push({ timeMs: 0, text: '' });
      }
      blank = true;
      continue;
    }
    blank = false;
    lines.push({ timeMs: 0, text: line });
  }
  while (lines.length > 0 && lines[lines.length - 1]?.text === '') {
    lines.pop();
  }
  return lines.slice(0, MAX_LINES);
}

export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function primaryArtist(artist: string): string {
  const first = artist.split(/\s*(?:,|&|\s+x\s+|\bfeat\b\.?|\bft\b\.?|\bfeaturing\b)\s*/i)[0] ?? '';
  return first.trim() === '' ? artist.trim() : first.trim();
}

export function cleanTitle(title: string, artist: string): string {
  let out = title.replace(/[([【][^)\]】]*[)\]】]/g, (group) =>
    NOISE_WORDS.test(group) || FEATURE.test(group) ? ' ' : group,
  );
  out = out.replace(
    /\s[-–—|]\s*[^-–—|]*\b(official|lyrics?|audio|video|remaster(ed)?|visuali[sz]er)\b[^-–—|]*$/i,
    '',
  );
  out = out.replace(/\s+\b(feat|ft|featuring)\b\.?\s.+$/i, '');
  const parts = out.split(/\s[-–—]\s/);
  const lead = primaryArtist(artist);
  if (parts.length === 2 && lead !== '' && normalize(parts[0] ?? '') === normalize(lead)) {
    out = parts[1] ?? out;
  }
  const result = out.replace(/\s+/g, ' ').trim();
  return result === '' ? title.trim() : result;
}

function titleMatches(candidate: string, query: LyricsQuery): boolean {
  const cleanedQuery = normalize(cleanTitle(query.title, query.artist));
  const rawQuery = normalize(query.title);
  const cleanedCandidate = normalize(cleanTitle(candidate, query.artist));
  const rawCandidate = normalize(candidate);
  if (cleanedCandidate === '' || cleanedQuery === '') {
    return false;
  }
  return (
    cleanedCandidate === cleanedQuery ||
    rawCandidate === rawQuery ||
    cleanedCandidate === rawQuery ||
    rawCandidate === cleanedQuery
  );
}

function artistMatches(candidate: string, query: LyricsQuery): boolean {
  const wanted = normalize(query.artist);
  const lead = normalize(primaryArtist(query.artist));
  const found = normalize(candidate);
  if (found === '' || wanted === '') {
    return false;
  }
  return found === wanted || found.includes(lead) || wanted.includes(found);
}

function durationGap(record: LrclibRecord, query: LyricsQuery): number {
  if (query.durationSec <= 0 || record.duration <= 0) {
    return 0;
  }
  return Math.abs(record.duration - query.durationSec);
}

export function canSync(record: LrclibRecord, query: LyricsQuery): boolean {
  return (
    typeof record.syncedLyrics === 'string' &&
    record.syncedLyrics.trim() !== '' &&
    (query.durationSec <= 0 || (record.duration > 0 && durationGap(record, query) <= SYNC_TOLERANCE_SEC))
  );
}

export function toRecord(value: unknown): LrclibRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const text = (key: string): string => (typeof raw[key] === 'string' ? raw[key] : '');
  const optional = (key: string): string | null =>
    typeof raw[key] === 'string' && raw[key].trim() !== '' ? raw[key] : null;
  const trackName = text('trackName') || text('name');
  if (trackName === '') {
    return null;
  }
  return {
    trackName,
    artistName: text('artistName'),
    albumName: text('albumName'),
    duration: typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? raw.duration : 0,
    instrumental: raw.instrumental === true,
    plainLyrics: optional('plainLyrics'),
    syncedLyrics: optional('syncedLyrics'),
  };
}

export function pickRecord(records: readonly LrclibRecord[], query: LyricsQuery): LrclibRecord | null {
  const matching = records.filter(
    (record) => titleMatches(record.trackName, query) && artistMatches(record.artistName, query),
  );
  const byGap = (a: LrclibRecord, b: LrclibRecord): number => durationGap(a, query) - durationGap(b, query);
  const synced = matching.filter((record) => canSync(record, query)).sort(byGap);
  if (synced[0]) {
    return synced[0];
  }
  const usable = matching
    .filter((record) => record.plainLyrics !== null || record.syncedLyrics !== null || record.instrumental)
    .sort(byGap);
  return usable[0] ?? null;
}

export function lyricsFromRecord(record: LrclibRecord, query: LyricsQuery): Lyrics | null {
  if (canSync(record, query) && record.syncedLyrics !== null) {
    const lines = parseLrc(record.syncedLyrics);
    if (lines.length > 0) {
      return { videoId: query.videoId, source: 'LRCLIB', synced: true, instrumental: false, lines };
    }
  }
  const plainSource = record.plainLyrics ?? record.syncedLyrics;
  if (plainSource !== null) {
    const lines = plainLines(plainSource);
    if (lines.length > 0) {
      return { videoId: query.videoId, source: 'LRCLIB', synced: false, instrumental: false, lines };
    }
  }
  if (record.instrumental) {
    return { videoId: query.videoId, source: 'LRCLIB', synced: false, instrumental: true, lines: [] };
  }
  return null;
}

function url(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== '') {
      search.set(key, value);
    }
  }
  return `${LRCLIB_BASE}/${path}?${search.toString()}`;
}

export async function findLyrics(query: LyricsQuery, deps: LyricsDeps): Promise<Lyrics | null> {
  let failures = 0;
  let attempts = 0;
  const plain: LrclibRecord[] = [];
  const load = async (target: string): Promise<unknown> => {
    attempts += 1;
    try {
      return await deps.fetchJson(target);
    } catch {
      failures += 1;
      return null;
    }
  };
  const cleaned = cleanTitle(query.title, query.artist);
  const lead = primaryArtist(query.artist);

  const exact = toRecord(
    await load(
      url('get', {
        track_name: query.title,
        artist_name: query.artist,
        album_name: query.album,
        duration: query.durationSec > 0 ? String(Math.round(query.durationSec)) : '',
      }),
    ),
  );
  if (exact && artistMatches(exact.artistName, query)) {
    if (canSync(exact, query)) {
      return lyricsFromRecord(exact, query);
    }
    plain.push(exact);
  }

  const searches = [
    url('search', { track_name: cleaned, artist_name: lead }),
    url('search', { q: `${lead} ${cleaned}`.trim() }),
  ];
  const responses = await Promise.all(searches.map((target) => load(target)));
  const found: LrclibRecord[] = [];
  for (const response of responses) {
    const records = Array.isArray(response)
      ? response.map(toRecord).filter((record): record is LrclibRecord => record !== null)
      : [];
    const best = pickRecord(records, query);
    if (best) {
      found.push(best);
    }
  }
  const synced = found.find((record) => canSync(record, query));
  if (synced) {
    return lyricsFromRecord(synced, query);
  }
  plain.push(...found);

  let ytmFailed = false;
  try {
    const ytm = await deps.ytm(query.videoId);
    if (ytm) {
      const lines = plainLines(ytm.text);
      if (lines.length > 0) {
        return { videoId: query.videoId, source: ytm.source, synced: false, instrumental: false, lines };
      }
    }
  } catch {
    ytmFailed = true;
  }

  for (const record of plain) {
    const lyrics = lyricsFromRecord(record, query);
    if (lyrics) {
      return lyrics;
    }
  }
  if (ytmFailed && failures === attempts) {
    throw new LyricsError('Lyrics could not be loaded. Check your connection.');
  }
  return null;
}

export function activeLine(lines: readonly LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const line = lines[mid];
    if (line && line.timeMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
