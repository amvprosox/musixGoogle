import { describe, expect, it } from 'vitest';
import { EMPTY_STATE } from '../src/contract';
import {
  bufferedAhead,
  diffState,
  isAllowedImageUrl,
  isProgressOnly,
  playlistIdFromUrl,
  queueEquals,
  roundTenth,
  videoIdFromUrl,
} from '../src/state';

describe('state diffing', () => {
  it('reports all keys for the first state and none for identical states', () => {
    expect(diffState(null, EMPTY_STATE).length).toBe(18);
    expect(diffState(EMPTY_STATE, { ...EMPTY_STATE })).toEqual([]);
  });

  it('treats position and buffer changes as progress only', () => {
    const changed = diffState(EMPTY_STATE, { ...EMPTY_STATE, positionSec: 1, bufferedSec: 4 });
    expect(isProgressOnly(changed)).toBe(true);
    expect(isProgressOnly(diffState(EMPTY_STATE, { ...EMPTY_STATE, positionSec: 1, isPlaying: true }))).toBe(
      false,
    );
    expect(isProgressOnly([])).toBe(false);
  });

  it('rounds to tenths', () => {
    expect(roundTenth(1.26)).toBe(1.3);
    expect(roundTenth(Number.NaN)).toBe(0);
  });

  it('finds the buffered range around the playhead', () => {
    const ranges = {
      length: 2,
      start: (i: number) => [0, 50][i] ?? 0,
      end: (i: number) => [20, 80][i] ?? 0,
    } as unknown as TimeRanges;
    expect(bufferedAhead({ buffered: ranges, currentTime: 10 })).toBe(20);
    expect(bufferedAhead({ buffered: ranges, currentTime: 60 })).toBe(80);
    expect(bufferedAhead({ buffered: ranges, currentTime: 30 })).toBe(30);
  });

  it('extracts ids from URLs', () => {
    expect(videoIdFromUrl('https://music.youtube.com/watch?v=lYBUbBu4W08&list=RDAMVM1')).toBe('lYBUbBu4W08');
    expect(playlistIdFromUrl('https://music.youtube.com/watch?v=lYBUbBu4W08&list=RDAMVM1')).toBe('RDAMVM1');
    expect(videoIdFromUrl('nonsense')).toBe('');
    expect(playlistIdFromUrl('https://music.youtube.com/watch?list=bad%20id')).toBe('');
  });

  it('accepts only https artwork from Google image hosts', () => {
    expect(isAllowedImageUrl('https://lh3.googleusercontent.com/a')).toBe(true);
    expect(isAllowedImageUrl('https://i.ytimg.com/vi/x/hq.jpg')).toBe(true);
    expect(isAllowedImageUrl('http://lh3.googleusercontent.com/a')).toBe(false);
    expect(isAllowedImageUrl('https://example.com/a.jpg')).toBe(false);
  });

  it('compares queues by value', () => {
    const entry = {
      index: 0,
      videoId: 'a',
      title: 't',
      artist: 'r',
      artworkUrl: '',
      durationSec: 1,
      isCurrent: false,
    };
    expect(queueEquals([entry], [{ ...entry }])).toBe(true);
    expect(queueEquals([entry], [{ ...entry, isCurrent: true }])).toBe(false);
  });
});
