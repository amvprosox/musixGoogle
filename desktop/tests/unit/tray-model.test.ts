import { describe, expect, it } from 'vitest';
import { EMPTY_PLAYER_STATE } from '../../src/shared/state-diff';
import { trayMenuModel } from '../../src/shared/tray-model';

describe('tray menu model', () => {
  it('describes an idle player', () => {
    expect(trayMenuModel(null, true)).toEqual({
      trackLabel: 'Nothing playing',
      playLabel: 'Play',
      windowLabel: 'Hide window',
      canControl: false,
    });
  });

  it('describes a playing track', () => {
    const model = trayMenuModel(
      { ...EMPTY_PLAYER_STATE, hasTrack: true, title: 'Song', artist: 'Band', isPlaying: true },
      false,
    );
    expect(model.trackLabel).toBe('Song - Band');
    expect(model.playLabel).toBe('Pause');
    expect(model.windowLabel).toBe('Show window');
    expect(model.canControl).toBe(true);
  });

  it('labels ads and truncates long titles', () => {
    expect(
      trayMenuModel({ ...EMPTY_PLAYER_STATE, hasTrack: true, title: 'x', isAd: true }, true).trackLabel,
    ).toBe('Advertisement');
    const long = trayMenuModel(
      { ...EMPTY_PLAYER_STATE, hasTrack: true, title: 'y'.repeat(100) },
      true,
    ).trackLabel;
    expect(long.length).toBe(64);
    expect(long.endsWith('...')).toBe(true);
  });
});
