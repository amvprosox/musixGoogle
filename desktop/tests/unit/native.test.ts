import { EMPTY_STATE } from '@musix/bridge/contract';
import { describe, expect, it } from 'vitest';
import {
  parseButtonLayout,
  routeCommand,
  toPlayerState,
  toQueueItems,
} from '../../src/shared/bridge-adapter';
import { buildMenuItems, isBlockedBrowserShortcut, placeMenu } from '../../src/shared/native';
import type { PlayerState } from '../../src/shared/types';

function keyInput(
  key: string,
  mods: Partial<{ control: boolean; meta: boolean; alt: boolean; shift: boolean }> = {},
) {
  return { key, control: false, meta: false, alt: false, shift: false, ...mods };
}

describe('bridge adapter', () => {
  it('maps bridge state to the desktop player state', () => {
    const state = toPlayerState({
      ...EMPTY_STATE,
      videoId: 'abc123def45',
      title: 'Song',
      artist: 'Artist',
      positionSec: 12.5,
      durationSec: 200,
      isPlaying: true,
      shuffle: true,
      repeatMode: 'ONE',
    });
    expect(state.hasTrack).toBe(true);
    expect(state.currentTimeSec).toBe(12.5);
    expect(state.videoId).toBe('abc123def45');
    expect(state.repeatMode).toBe('ONE');
    expect(toPlayerState(EMPTY_STATE).hasTrack).toBe(false);
    expect(toPlayerState({ ...EMPTY_STATE, videoId: 'x'.repeat(65) }).videoId).toBe('');
  });

  it('maps queue entries with formatted durations', () => {
    const items = toQueueItems([
      {
        index: 0,
        videoId: 'a',
        title: 'One',
        artist: 'A',
        artworkUrl: '',
        durationSec: 125,
        isCurrent: true,
      },
      { index: 1, videoId: 'b', title: 'Two', artist: 'B', artworkUrl: '', durationSec: 0, isCurrent: false },
    ]);
    expect(items[0]).toMatchObject({ index: 0, title: 'One', duration: '2:05', isCurrent: true });
    expect(items[1]?.duration).toBe('');
  });

  it('routes playback commands to the bridge with a versioned envelope', () => {
    expect(routeCommand({ type: 'togglePlay' }, null, 'r1')).toEqual({
      channel: 'bridge',
      command: { v: 1, requestId: 'r1', type: 'togglePlay' },
    });
    expect(routeCommand({ type: 'seekTo', seconds: 30 }, null, 'r2')).toEqual({
      channel: 'bridge',
      command: { v: 1, requestId: 'r2', type: 'seekTo', seconds: 30 },
    });
    expect(routeCommand({ type: 'playQueueIndex', index: 3 }, null, 'r3').command).toMatchObject({
      type: 'playQueueIndex',
      index: 3,
    });
  });

  it('turns toggle commands into explicit bridge state changes', () => {
    const current = { shuffle: true, repeatMode: 'ALL' } as PlayerState;
    expect(routeCommand({ type: 'toggleShuffle' }, current, 'r').command).toMatchObject({
      type: 'setShuffle',
      enabled: false,
    });
    expect(routeCommand({ type: 'toggleShuffle' }, null, 'r').command).toMatchObject({
      type: 'setShuffle',
      enabled: true,
    });
    expect(routeCommand({ type: 'cycleRepeat' }, current, 'r').command).toMatchObject({
      type: 'setRepeat',
      mode: 'ONE',
    });
    expect(routeCommand({ type: 'cycleRepeat' }, null, 'r').command).toMatchObject({
      type: 'setRepeat',
      mode: 'ALL',
    });
  });

  it('routes navigation commands to the desktop channel', () => {
    expect(routeCommand({ type: 'search', query: 'jazz' }, null, 'r')).toEqual({
      channel: 'desktop',
      command: { type: 'searchPage', query: 'jazz' },
    });
    expect(routeCommand({ type: 'navigate', route: 'library' }, null, 'r')).toEqual({
      channel: 'desktop',
      command: { type: 'navigate', route: 'library' },
    });
    expect(routeCommand({ type: 'signIn' }, null, 'r').channel).toBe('desktop');
    expect(routeCommand({ type: 'openAccountMenu' }, null, 'r').channel).toBe('desktop');
  });

  it('parses GNOME button layouts', () => {
    expect(parseButtonLayout("'appmenu:minimize,maximize,close'\n")).toEqual({
      side: 'right',
      buttons: ['minimize', 'maximize', 'close'],
    });
    expect(parseButtonLayout("'appmenu:close'")).toEqual({ side: 'right', buttons: ['close'] });
    expect(parseButtonLayout("'close,minimize,maximize:'")).toEqual({
      side: 'left',
      buttons: ['close', 'minimize', 'maximize'],
    });
    expect(parseButtonLayout('')).toEqual({ side: 'right', buttons: ['minimize', 'maximize', 'close'] });
    expect(parseButtonLayout("'appmenu:spacer'")).toEqual({
      side: 'right',
      buttons: ['minimize', 'maximize', 'close'],
    });
  });
});

describe('context menu model', () => {
  it('builds item menus in a fixed order and disables unavailable actions', () => {
    const items = buildMenuItems(
      { kind: 'ytm', token: 't' },
      { title: 'Song', actions: ['playNext', 'copyLink'] },
      false,
    );
    expect(items.map((item) => item.id)).toEqual([
      'playNext',
      'addToQueue',
      'like',
      'goArtist',
      'goAlbum',
      'copyLink',
    ]);
    expect(items.filter((item) => !item.disabled).map((item) => item.id)).toEqual(['playNext', 'copyLink']);
    expect(items[0]).toMatchObject({ label: 'Play next', icon: 'list-start' });
  });

  it('builds text menus and disables paste without clipboard text', () => {
    const empty = buildMenuItems({ kind: 'shellText' }, { title: '', actions: [] }, false);
    expect(empty.map((item) => item.id)).toEqual(['cut', 'copy', 'paste', 'selectAll']);
    expect(empty.find((item) => item.id === 'paste')?.disabled).toBe(true);
    const filled = buildMenuItems({ kind: 'ytmText' }, { title: '', actions: [] }, true);
    expect(filled.every((item) => !item.disabled)).toBe(true);
  });

  it('places menus at the pointer and flips them inside the window', () => {
    const container = { width: 1000, height: 800 };
    expect(placeMenu({ x: 100, y: 100 }, { width: 220, height: 300 }, container)).toEqual({
      x: 100,
      y: 100,
      width: 220,
      height: 300,
    });
    expect(placeMenu({ x: 900, y: 700 }, { width: 220, height: 300 }, container)).toEqual({
      x: 680,
      y: 400,
      width: 220,
      height: 300,
    });
    expect(placeMenu({ x: 50, y: 50 }, { width: 220, height: 2000 }, container)).toEqual({
      x: 50,
      y: 8,
      width: 220,
      height: 784,
    });
    const tiny = placeMenu({ x: 10, y: 10 }, { width: 400, height: 100 }, { width: 300, height: 300 });
    expect(tiny.x).toBeGreaterThanOrEqual(8);
    expect(tiny.width).toBe(284);
  });
});

describe('browser shortcut blocking', () => {
  it('blocks reload, print, save, source, find, and zoom', () => {
    for (const key of ['r', 'p', 's', 'u', 'f', '+', '=', '-', '0']) {
      expect(isBlockedBrowserShortcut(keyInput(key, { control: true }), false), key).toBe(true);
    }
    expect(isBlockedBrowserShortcut(keyInput('R', { control: true, shift: true }), false)).toBe(true);
    expect(isBlockedBrowserShortcut(keyInput('F5'), false)).toBe(true);
    expect(isBlockedBrowserShortcut(keyInput('BrowserBack'), false)).toBe(true);
  });

  it('blocks devtools unless dev mode is on', () => {
    expect(isBlockedBrowserShortcut(keyInput('I', { control: true, shift: true }), false)).toBe(true);
    expect(isBlockedBrowserShortcut(keyInput('F12'), false)).toBe(true);
    expect(isBlockedBrowserShortcut(keyInput('I', { control: true, shift: true }), true)).toBe(false);
    expect(isBlockedBrowserShortcut(keyInput('F12'), true)).toBe(false);
  });

  it('leaves app shortcuts and plain typing alone', () => {
    expect(isBlockedBrowserShortcut(keyInput('k', { control: true }), false)).toBe(false);
    expect(isBlockedBrowserShortcut(keyInput('q', { control: true }), false)).toBe(false);
    expect(isBlockedBrowserShortcut(keyInput('a', { control: true }), false)).toBe(false);
    expect(isBlockedBrowserShortcut(keyInput('c', { control: true }), false)).toBe(false);
    expect(isBlockedBrowserShortcut(keyInput('r'), false)).toBe(false);
    expect(isBlockedBrowserShortcut(keyInput(' '), false)).toBe(false);
  });
});
