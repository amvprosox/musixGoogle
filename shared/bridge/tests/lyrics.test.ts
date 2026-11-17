import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeLine,
  cleanTitle,
  findLyrics,
  parseLrc,
  pickRecord,
  plainLines,
  primaryArtist,
  toRecord,
  type LrclibRecord,
  type LyricsQuery,
} from '../src/lyrics';
import { parseSuggestions } from '../src/parse';
import { isLyrics, isSearchSuggestions } from '../src/validate';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'),
  ) as unknown;
}

const QUERY: LyricsQuery = {
  videoId: 'J7p4bzqLvCw',
  title: 'Blinding Lights',
  artist: 'The Weeknd',
  album: 'After Hours',
  durationSec: 200,
};

describe('lrc parsing', () => {
  it('reads every timestamp format, repeated tags, offsets and word timing', () => {
    const lines = parseLrc(
      '[ar:Someone]\n[offset:+500]\n[00:01.5]one\n[00:02.25][01:00.125]two\n[00:03]<00:03.10>three <00:03.50>words\n[00:04.00]\n',
    );
    expect(lines).toEqual([
      { timeMs: 1000, text: 'one' },
      { timeMs: 1750, text: 'two' },
      { timeMs: 2500, text: 'three words' },
      { timeMs: 3500, text: '♪' },
      { timeMs: 59625, text: 'two' },
    ]);
  });

  it('keeps stanza breaks in plain lyrics without leading or trailing blanks', () => {
    expect(plainLines('\n\nA\nB\n\n\nC\n\n')).toEqual([
      { timeMs: 0, text: 'A' },
      { timeMs: 0, text: 'B' },
      { timeMs: 0, text: '' },
      { timeMs: 0, text: 'C' },
    ]);
  });

  it('finds the line for a playback position', () => {
    const lines = parseLrc('[00:01.00]a\n[00:02.00]b\n[00:03.00]c');
    expect(activeLine(lines, 500)).toBe(-1);
    expect(activeLine(lines, 1000)).toBe(0);
    expect(activeLine(lines, 2999)).toBe(1);
    expect(activeLine(lines, 9000)).toBe(2);
  });
});

describe('track matching', () => {
  it('cleans video titles and artist lists', () => {
    expect(cleanTitle('Blinding Lights (Official Video)', 'The Weeknd')).toBe('Blinding Lights');
    expect(cleanTitle('The Weeknd - Blinding Lights [Lyrics]', 'The Weeknd')).toBe('Blinding Lights');
    expect(cleanTitle('Song (feat. Someone) - Remastered 2011', 'Band')).toBe('Song');
    expect(cleanTitle('Love (Live)', 'Band')).toBe('Love (Live)');
    expect(primaryArtist('Calvin Harris, Dua Lipa')).toBe('Calvin Harris');
    expect(primaryArtist('Silk Sonic & Bruno Mars')).toBe('Silk Sonic');
  });

  it('only accepts synced lyrics whose length matches the track', () => {
    const records = (fixture('lrclib-search') as unknown[])
      .map(toRecord)
      .filter((record): record is LrclibRecord => record !== null);
    expect(pickRecord(records, { ...QUERY, durationSec: 201.6 })?.duration).toBe(202);
    const far = pickRecord(records, { ...QUERY, durationSec: 320 });
    expect(far?.syncedLyrics).not.toBeNull();
  });

  it('prefers the exact lookup and never syncs a mismatched length', async () => {
    const urls: string[] = [];
    const deps = {
      fetchJson: (url: string) => {
        urls.push(url);
        return Promise.resolve(url.includes('/get?') ? fixture('lrclib-get') : []);
      },
    };
    const synced = await findLyrics(QUERY, deps);
    expect(synced?.synced).toBe(true);
    expect(urls).toHaveLength(1);
    const mismatch = await findLyrics({ ...QUERY, durationSec: 240 }, deps);
    expect(mismatch?.synced).toBe(false);
    expect(mismatch?.lines[0]?.text).toBe('Yeah');
    expect(isLyrics(mismatch)).toBe(true);
  });

  it('reports a network failure only when every source failed', async () => {
    const failing = {
      fetchJson: () => Promise.reject(new Error('offline')),
    };
    await expect(findLyrics(QUERY, failing)).rejects.toThrow('Lyrics could not be loaded');
    const empty = { fetchJson: () => Promise.resolve(null) };
    await expect(findLyrics(QUERY, empty)).resolves.toBeNull();
  });
});

describe('youtube music responses', () => {
  it('parses search suggestions into queries and top results', () => {
    const suggestions = parseSuggestions(fixture('search-suggestions'), 'blinding li');
    expect(suggestions.queries.slice(0, 2)).toEqual(['blinding lights the weeknd', 'blinding lights']);
    expect(suggestions.items.length).toBeGreaterThan(0);
    expect(suggestions.items[0]).toMatchObject({ title: 'Blinding Lights', playable: true });
    expect(isSearchSuggestions(suggestions)).toBe(true);
  });
});

describe('findLyrics re-upload fallbacks', () => {
  const lrc = '[00:01.00]first line\n[00:05.00]second line';
  const search = (records: unknown[]) => (url: string) => {
    if (url.includes('/get?')) {
      return Promise.resolve(null);
    }
    return Promise.resolve(records.filter((r) => (r as { match: (u: string) => boolean }).match(url)));
  };

  it('uses "Artist - Song" from the title when the uploader is listed as the artist', async () => {
    const record = {
      trackName: 'Groupie',
      artistName: '27CLUB',
      duration: 202,
      syncedLyrics: lrc,
      match: (u: string) => u.includes('artist_name=27CLUB'),
    };
    const lyrics = await findLyrics(
      {
        videoId: 'AU382pMO6RI',
        title: '27CLUB - Groupie (Prod. Steezefield)',
        artist: 'SwagyTracks',
        album: '',
        durationSec: 203,
      },
      { fetchJson: search([record]) },
    );
    expect(lyrics?.synced).toBe(true);
  });

  it('matches the song title alone when the length is within a few seconds', async () => {
    const record = {
      trackName: 'The Red Jumpsuit Apparatus - Face Down',
      artistName: 'The Red Jumpsuit Apparatus',
      duration: 192,
      syncedLyrics: lrc,
      match: (u: string) => u.includes('track_name=face+down') && !u.includes('artist_name'),
    };
    const lyrics = await findLyrics(
      {
        videoId: 'W8wvyPDZo_w',
        title: 'Face Down With Lyrics',
        artist: 'Shiina Kurisu',
        album: '',
        durationSec: 193,
      },
      { fetchJson: search([record]) },
    );
    expect(lyrics?.synced).toBe(true);
    const wrongLength = await findLyrics(
      {
        videoId: 'W8wvyPDZo_w',
        title: 'Face Down With Lyrics',
        artist: 'Shiina Kurisu',
        album: '',
        durationSec: 240,
      },
      { fetchJson: search([record]) },
    );
    expect(wrongLength).toBeNull();
  });
});
