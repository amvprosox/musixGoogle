import type { PlayerState, QueueItem } from './types';

export const PLAYER_STATE_KEYS: readonly (keyof PlayerState)[] = [
  'hasTrack',
  'title',
  'artist',
  'album',
  'artworkUrl',
  'durationSec',
  'currentTimeSec',
  'isPlaying',
  'volume',
  'isMuted',
  'likeStatus',
  'shuffle',
  'repeatMode',
  'videoId',
  'isAd',
];

export const EMPTY_PLAYER_STATE: Readonly<PlayerState> = {
  hasTrack: false,
  title: '',
  artist: '',
  album: '',
  artworkUrl: '',
  durationSec: 0,
  currentTimeSec: 0,
  isPlaying: false,
  volume: 1,
  isMuted: false,
  likeStatus: 'INDIFFERENT',
  shuffle: false,
  repeatMode: 'NONE',
  videoId: '',
  isAd: false,
};

export function diffPlayerState(prev: PlayerState | null, next: PlayerState): (keyof PlayerState)[] {
  if (!prev) {
    return [...PLAYER_STATE_KEYS];
  }
  return PLAYER_STATE_KEYS.filter((key) => prev[key] !== next[key]);
}

export function isProgressOnlyChange(changed: readonly (keyof PlayerState)[]): boolean {
  return changed.length === 1 && changed[0] === 'currentTimeSec';
}

export function roundTime(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }
  return Math.round(seconds * 10) / 10;
}

export function queueEquals(a: readonly QueueItem[], b: readonly QueueItem[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((item, i) => {
    const other = b[i];
    if (!other) {
      return false;
    }
    return (
      item.index === other.index &&
      item.title === other.title &&
      item.artist === other.artist &&
      item.duration === other.duration &&
      item.thumbnailUrl === other.thumbnailUrl &&
      item.isCurrent === other.isCurrent
    );
  });
}

export function isTrackChange(prev: PlayerState | null, next: PlayerState): boolean {
  if (!next.hasTrack || next.isAd) {
    return false;
  }
  if (!prev) {
    return true;
  }
  if (next.videoId !== '' && prev.videoId !== '') {
    return prev.videoId !== next.videoId;
  }
  return prev.title !== next.title || prev.artist !== next.artist;
}
