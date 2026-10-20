import { describe, expect, it } from 'vitest';
import {
  decideMpris,
  isBoundsVisibleOnDisplays,
  placeFloating,
  roundRect,
  shouldNotifyTrackChange,
} from '../../src/shared/policies';
import { EMPTY_PLAYER_STATE } from '../../src/shared/state-diff';
import type { PlayerState } from '../../src/shared/types';

const a: PlayerState = {
  ...EMPTY_PLAYER_STATE,
  hasTrack: true,
  title: 'A',
  artist: 'X',
  videoId: 'aaaaaaaaaaa',
};
const b: PlayerState = { ...a, title: 'B', videoId: 'bbbbbbbbbbb' };

describe('track notifications', () => {
  it('notifies on track change in the background', () => {
    expect(shouldNotifyTrackChange({ enabled: true, windowFocused: false, prev: a, next: b })).toBe(true);
  });

  it('skips when focused, disabled, unchanged, or during ads', () => {
    expect(shouldNotifyTrackChange({ enabled: true, windowFocused: true, prev: a, next: b })).toBe(false);
    expect(shouldNotifyTrackChange({ enabled: false, windowFocused: false, prev: a, next: b })).toBe(false);
    expect(shouldNotifyTrackChange({ enabled: true, windowFocused: false, prev: a, next: { ...a } })).toBe(
      false,
    );
    expect(
      shouldNotifyTrackChange({ enabled: true, windowFocused: false, prev: a, next: { ...b, isAd: true } }),
    ).toBe(false);
  });
});

describe('MPRIS fallback decision', () => {
  const base = {
    chromiumDetected: false,
    fallbackActive: false,
    playbackStartedAt: 1000,
    now: 1000,
    detectWindowMs: 3000,
  };
  it('waits during the detection window', () => {
    expect(decideMpris({ ...base, now: 2500 })).toBe('keep');
  });
  it('starts the fallback after 3 seconds without a media session', () => {
    expect(decideMpris({ ...base, now: 4000 })).toBe('start-fallback');
  });
  it('stops the fallback when Chromium appears', () => {
    expect(decideMpris({ ...base, chromiumDetected: true, fallbackActive: true })).toBe('stop-fallback');
    expect(decideMpris({ ...base, chromiumDetected: true })).toBe('keep');
  });
  it('does nothing before playback', () => {
    expect(decideMpris({ ...base, playbackStartedAt: null, now: 99999 })).toBe('keep');
  });
});

describe('window geometry', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  it('accepts windows on a display', () => {
    expect(isBoundsVisibleOnDisplays({ x: 100, y: 100, width: 800, height: 600 }, displays)).toBe(true);
  });
  it('rejects windows on a missing display', () => {
    expect(isBoundsVisibleOnDisplays({ x: 3000, y: 100, width: 800, height: 600 }, displays)).toBe(false);
    expect(isBoundsVisibleOnDisplays({ x: 100, y: -2000, width: 800, height: 600 }, displays)).toBe(false);
  });
  it('rounds rectangles without gaps', () => {
    expect(roundRect({ x: 72.4, y: 63.6, width: 100.2, height: 10.5 })).toEqual({
      x: 72,
      y: 64,
      width: 101,
      height: 10,
    });
  });
  it('places floating layers inside the window', () => {
    const container = { width: 1000, height: 800 };
    const top = placeFloating(
      { x: 500, y: 700, width: 40, height: 40 },
      { width: 80, height: 30 },
      'top',
      container,
    );
    expect(top).toEqual({ x: 480, y: 662, width: 80, height: 30 });
    const flipped = placeFloating(
      { x: 500, y: 5, width: 40, height: 40 },
      { width: 80, height: 30 },
      'top',
      container,
    );
    expect(flipped.y).toBe(53);
    const clamped = placeFloating(
      { x: 990, y: 400, width: 10, height: 10 },
      { width: 120, height: 30 },
      'bottom',
      container,
    );
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(992);
  });
});
