import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { EMPTY_PLAYER_STATE } from '../../src/shared/state-diff';
import {
  activeRoute,
  createStore,
  displayedPlaying,
  initialState,
  reducer,
  shallowEqual,
} from '../../src/renderer/state';

const base = 'https://music.youtube.com';

function init(width = 1440) {
  return reducer(initialState(width, 'dark', false, base), {
    type: 'init',
    settings: { ...DEFAULT_SETTINGS },
    sidebarCollapsed: false,
    adblock: {
      enabled: true,
      ready: true,
      blockedCount: 0,
      lastUpdated: null,
      updating: false,
      lastError: null,
    },
    account: { signedIn: false, avatarUrl: '' },
    nav: { url: `${base}/explore`, canGoBack: false, canGoForward: false },
    viewStatus: { kind: 'ready' },
    version: '1.0.0',
    systemDark: true,
    ytmBase: base,
    chrome: {
      maximized: false,
      fullscreen: false,
      focused: true,
      side: 'right',
      buttons: ['minimize', 'maximize', 'close'],
    },
  });
}

describe('shell state', () => {
  it('derives route and docked queue on init', () => {
    const state = init();
    expect(state.route).toBe('explore');
    expect(state.queueOpen).toBe(true);
    expect(state.theme).toBe('dark');
  });

  it('keeps optimistic play state until the bridge confirms it', () => {
    let state = reducer(init(), {
      type: 'player',
      player: { ...EMPTY_PLAYER_STATE, hasTrack: true, isPlaying: false },
    });
    state = reducer(state, { type: 'optimistic-playing', value: true });
    expect(displayedPlaying(state)).toBe(true);
    state = reducer(state, {
      type: 'player',
      player: { ...EMPTY_PLAYER_STATE, hasTrack: true, isPlaying: false, currentTimeSec: 1 },
    });
    expect(state.optimisticPlaying).toBe(true);
    state = reducer(state, {
      type: 'player',
      player: { ...EMPTY_PLAYER_STATE, hasTrack: true, isPlaying: true },
    });
    expect(state.optimisticPlaying).toBeNull();
    expect(displayedPlaying(state)).toBe(true);
  });

  it('switches layouts across breakpoints', () => {
    let state = init();
    state = reducer(state, { type: 'width', width: 1000 });
    expect(state.breakpoint).toBe('md');
    expect(state.layout.sidebarMode).toBe('rail');
    expect(state.queueOpen).toBe(false);
    state = reducer(state, { type: 'width', width: 800 });
    expect(state.layout.sidebarMode).toBe('drawer');
    state = reducer(state, { type: 'sidebar-drawer', open: true });
    expect(state.sidebarDrawerOpen).toBe(true);
    state = reducer(state, { type: 'width', width: 500 });
    expect(state.sidebarDrawerOpen).toBe(false);
    expect(state.layout.compactPlayer).toBe(true);
    state = reducer(state, { type: 'width', width: 1600 });
    expect(state.queueOpen).toBe(true);
  });

  it('reports settings as the active route when open', () => {
    const state = reducer(init(), { type: 'settings-open', open: true });
    expect(activeRoute(state)).toBe('settings');
  });

  it('notifies selectors only on change', () => {
    const store = createStore(init());
    const seen: string[] = [];
    store.select(
      (s) => s.route,
      (route) => seen.push(route),
    );
    store.dispatch({ type: 'online', online: false });
    store.dispatch({ type: 'nav', nav: { url: `${base}/library`, canGoBack: true, canGoForward: false } });
    expect(seen).toEqual(['explore', 'library']);
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(shallowEqual([1, 2], [1, 3])).toBe(false);
  });
});
