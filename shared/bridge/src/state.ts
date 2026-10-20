import type { BridgeState, QueueEntry } from './contract';

export const STATE_KEYS: readonly (keyof BridgeState)[] = [
  'videoId',
  'playlistId',
  'title',
  'artist',
  'album',
  'artworkUrl',
  'durationSec',
  'positionSec',
  'bufferedSec',
  'isPlaying',
  'isBuffering',
  'volume',
  'isMuted',
  'likeStatus',
  'shuffle',
  'repeatMode',
  'isAd',
  'isSignedIn',
];

const PROGRESS_KEYS: readonly (keyof BridgeState)[] = ['positionSec', 'bufferedSec'];

export function diffState(prev: BridgeState | null, next: BridgeState): (keyof BridgeState)[] {
  if (!prev) {
    return [...STATE_KEYS];
  }
  return STATE_KEYS.filter((key) => prev[key] !== next[key]);
}

export function isProgressOnly(changed: readonly (keyof BridgeState)[]): boolean {
  return changed.length > 0 && changed.every((key) => PROGRESS_KEYS.includes(key));
}

export function roundTenth(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }
  return Math.round(seconds * 10) / 10;
}

export function queueEquals(a: readonly QueueEntry[], b: readonly QueueEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        item.videoId === other.videoId &&
        item.title === other.title &&
        item.artist === other.artist &&
        item.artworkUrl === other.artworkUrl &&
        item.durationSec === other.durationSec &&
        item.isCurrent === other.isCurrent
      );
    })
  );
}

export function bufferedAhead(video: { buffered: TimeRanges; currentTime: number }): number {
  const ranges = video.buffered;
  for (let i = 0; i < ranges.length; i += 1) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (video.currentTime >= start - 0.5 && video.currentTime <= end + 0.5) {
      return end;
    }
  }
  return video.currentTime;
}

export function playlistIdFromUrl(url: string): string {
  try {
    const list = new URL(url).searchParams.get('list');
    return list && /^[A-Za-z0-9_-]{2,128}$/.test(list) ? list : '';
  } catch {
    return '';
  }
}

export function videoIdFromUrl(url: string): string {
  try {
    const id = new URL(url).searchParams.get('v');
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

export function isAllowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      [/(^|\.)googleusercontent\.com$/, /(^|\.)ggpht\.com$/, /(^|\.)ytimg\.com$/].some((pattern) =>
        pattern.test(parsed.hostname),
      )
    );
  } catch {
    return false;
  }
}
