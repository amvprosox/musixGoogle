import { describe, expect, it } from 'vitest';
import {
  diffPlayerState,
  EMPTY_PLAYER_STATE,
  isProgressOnlyChange,
  isTrackChange,
  PLAYER_STATE_KEYS,
  queueEquals,
  roundTime,
} from '../../src/shared/state-diff';
import type { PlayerState, QueueItem } from '../../src/shared/types';

const track: PlayerState = {
  ...EMPTY_PLAYER_STATE,
  hasTrack: true,
  title: 'Song',
  artist: 'Artist',
  videoId: 'abc123def45',
  durationSec: 200,
  currentTimeSec: 10,
  isPlaying: true,
};

describe('player state diffing', () => {
  it('reports every key for the first state', () => {
    expect(diffPlayerState(null, track)).toEqual([...PLAYER_STATE_KEYS]);
  });

  it('reports no change for identical state', () => {
    expect(diffPlayerState(track, { ...track })).toEqual([]);
  });

  it('detects progress-only changes', () => {
    const changed = diffPlayerState(track, { ...track, currentTimeSec: 10.3 });
    expect(changed).toEqual(['currentTimeSec']);
    expect(isProgressOnlyChange(changed)).toBe(true);
  });

  it('detects structural changes', () => {
    const changed = diffPlayerState(track, { ...track, isPlaying: false, currentTimeSec: 11 });
    expect(changed).toContain('isPlaying');
    expect(isProgressOnlyChange(changed)).toBe(false);
  });

  it('rounds time to tenths', () => {
    expect(roundTime(10.06)).toBe(10.1);
    expect(roundTime(-1)).toBe(0);
    expect(roundTime(Number.NaN)).toBe(0);
  });

  it('detects track changes and ignores ads', () => {
    expect(isTrackChange(null, track)).toBe(true);
    expect(isTrackChange(track, { ...track, currentTimeSec: 50 })).toBe(false);
    expect(isTrackChange(track, { ...track, videoId: 'zzz111yyy22', title: 'Other' })).toBe(true);
    expect(isTrackChange(track, { ...track, videoId: 'zzz111yyy22', isAd: true })).toBe(false);
    expect(isTrackChange({ ...track, videoId: '' }, { ...track, videoId: '', title: 'New' })).toBe(true);
  });
});

describe('queue equality', () => {
  const item: QueueItem = {
    index: 0,
    thumbnailUrl: '',
    title: 'A',
    artist: 'B',
    duration: '1:00',
    isCurrent: false,
  };
  it('compares by value', () => {
    expect(queueEquals([item], [{ ...item }])).toBe(true);
    expect(queueEquals([item], [{ ...item, isCurrent: true }])).toBe(false);
    expect(queueEquals([item], [])).toBe(false);
  });
});
