import {
  layoutFor,
  queueOpenByDefault,
  resolveBreakpoint,
  type Breakpoint,
  type LayoutSpec,
} from '../shared/breakpoints';
import { routeFromUrl, searchQueryFromUrl } from '../shared/routes';
import { DEFAULT_SETTINGS, resolveTheme } from '../shared/settings';
import type {
  AccountState,
  AdblockStatus,
  AppSettings,
  PlayerState,
  QueueItem,
  ResolvedTheme,
  ShellRoute,
  ViewNavState,
  ViewStatus,
  WindowChromeState,
} from '../shared/types';

export interface ModalSpec {
  id: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string | null;
  tone: 'danger' | 'default';
}

export interface ShellState {
  initialized: boolean;
  player: PlayerState | null;
  optimisticPlaying: boolean | null;
  queue: QueueItem[];
  viewStatus: ViewStatus;
  nav: ViewNavState;
  route: ShellRoute;
  searchQuery: string;
  settingsOpen: boolean;
  account: AccountState;
  settings: AppSettings;
  adblock: AdblockStatus;
  online: boolean;
  systemDark: boolean;
  theme: ResolvedTheme;
  breakpoint: Breakpoint;
  layout: LayoutSpec;
  sidebarCollapsed: boolean;
  sidebarDrawerOpen: boolean;
  queueOpen: boolean;
  nowPlayingOpen: boolean;
  searchOverlayOpen: boolean;
  volumePopoverOpen: boolean;
  modal: ModalSpec | null;
  version: string;
  ytmBase: string;
  chrome: WindowChromeState;
  navigating: boolean;
}

export type Action =
  | {
      type: 'init';
      settings: AppSettings;
      sidebarCollapsed: boolean;
      adblock: AdblockStatus;
      account: AccountState;
      nav: ViewNavState;
      viewStatus: ViewStatus;
      version: string;
      systemDark: boolean;
      ytmBase: string;
      chrome: WindowChromeState;
    }
  | { type: 'chrome'; chrome: WindowChromeState }
  | { type: 'navigating'; value: boolean }
  | { type: 'player'; player: PlayerState }
  | { type: 'optimistic-playing'; value: boolean | null }
  | { type: 'queue'; queue: QueueItem[] }
  | { type: 'view-status'; status: ViewStatus }
  | { type: 'nav'; nav: ViewNavState }
  | { type: 'settings-open'; open: boolean }
  | { type: 'account'; account: AccountState }
  | { type: 'settings'; settings: AppSettings }
  | { type: 'adblock'; adblock: AdblockStatus }
  | { type: 'online'; online: boolean }
  | { type: 'system-dark'; dark: boolean }
  | { type: 'width'; width: number }
  | { type: 'sidebar-collapsed'; collapsed: boolean }
  | { type: 'sidebar-drawer'; open: boolean }
  | { type: 'queue-open'; open: boolean }
  | { type: 'now-playing'; open: boolean }
  | { type: 'search-overlay'; open: boolean }
  | { type: 'volume-popover'; open: boolean }
  | { type: 'modal'; modal: ModalSpec | null };

export function initialState(
  width: number,
  theme: ResolvedTheme,
  sidebarCollapsed: boolean,
  base: string,
): ShellState {
  const breakpoint = resolveBreakpoint(width);
  return {
    initialized: false,
    player: null,
    optimisticPlaying: null,
    queue: [],
    viewStatus: { kind: 'loading' },
    nav: { url: '', canGoBack: false, canGoForward: false },
    route: 'home',
    searchQuery: '',
    settingsOpen: false,
    account: { signedIn: false, avatarUrl: '' },
    settings: { ...DEFAULT_SETTINGS },
    adblock: {
      enabled: true,
      ready: false,
      blockedCount: 0,
      lastUpdated: null,
      updating: false,
      lastError: null,
    },
    online: true,
    systemDark: theme === 'dark',
    theme,
    breakpoint,
    layout: layoutFor(breakpoint, sidebarCollapsed),
    sidebarCollapsed,
    sidebarDrawerOpen: false,
    queueOpen: queueOpenByDefault(breakpoint, DEFAULT_SETTINGS.queueOpenOnWideScreens),
    nowPlayingOpen: false,
    searchOverlayOpen: false,
    volumePopoverOpen: false,
    modal: null,
    version: '',
    ytmBase: base,
    chrome: {
      maximized: false,
      fullscreen: false,
      focused: true,
      side: 'right',
      buttons: ['minimize', 'maximize', 'close'],
    },
    navigating: false,
  };
}

function withBreakpoint(state: ShellState, breakpoint: Breakpoint): ShellState {
  if (breakpoint === state.breakpoint) {
    return state;
  }
  const layout = layoutFor(breakpoint, state.sidebarCollapsed);
  const wasDocked = state.layout.queueMode === 'docked';
  const isDocked = layout.queueMode === 'docked';
  let queueOpen = state.queueOpen;
  if (breakpoint === 'xl' && state.breakpoint !== 'xl') {
    queueOpen = state.settings.queueOpenOnWideScreens || (wasDocked && state.queueOpen);
  } else if (wasDocked !== isDocked || layout.queueMode !== state.layout.queueMode) {
    queueOpen = isDocked ? state.queueOpen : false;
  }
  return {
    ...state,
    breakpoint,
    layout,
    queueOpen,
    sidebarDrawerOpen: layout.sidebarMode === 'drawer' ? state.sidebarDrawerOpen : false,
    nowPlayingOpen: layout.compactPlayer ? state.nowPlayingOpen : false,
    searchOverlayOpen: breakpoint === 'xs' ? state.searchOverlayOpen : false,
    volumePopoverOpen: layout.volumeMode === 'popover' ? state.volumePopoverOpen : false,
  };
}

export function reducer(state: ShellState, action: Action): ShellState {
  switch (action.type) {
    case 'init': {
      const theme = resolveTheme(action.settings.theme, action.systemDark);
      const layout = layoutFor(state.breakpoint, action.sidebarCollapsed);
      const ytmBase = action.ytmBase;
      return {
        ...state,
        ytmBase,
        chrome: action.chrome,
        initialized: true,
        settings: action.settings,
        sidebarCollapsed: action.sidebarCollapsed,
        layout,
        adblock: action.adblock,
        account: action.account,
        nav: action.nav,
        route: action.nav.url === '' ? state.route : routeFromUrl(action.nav.url, ytmBase),
        searchQuery: searchQueryFromUrl(action.nav.url),
        viewStatus: action.viewStatus,
        version: action.version,
        systemDark: action.systemDark,
        theme,
        queueOpen:
          layout.queueMode === 'docked'
            ? queueOpenByDefault(state.breakpoint, action.settings.queueOpenOnWideScreens)
            : false,
      };
    }
    case 'chrome':
      return { ...state, chrome: action.chrome };
    case 'navigating':
      return { ...state, navigating: action.value };
    case 'player': {
      const optimistic =
        state.optimisticPlaying !== null && action.player.isPlaying === state.optimisticPlaying
          ? null
          : state.optimisticPlaying;
      return { ...state, player: action.player, optimisticPlaying: optimistic };
    }
    case 'optimistic-playing':
      return { ...state, optimisticPlaying: action.value };
    case 'queue':
      return { ...state, queue: action.queue };
    case 'view-status':
      return { ...state, viewStatus: action.status };
    case 'nav': {
      const route = routeFromUrl(action.nav.url, state.ytmBase);
      return {
        ...state,
        nav: action.nav,
        route,
        searchQuery: route === 'search' ? searchQueryFromUrl(action.nav.url) : state.searchQuery,
      };
    }
    case 'settings-open':
      return {
        ...state,
        settingsOpen: action.open,
        sidebarDrawerOpen: false,
        searchOverlayOpen: false,
        queueOpen: state.layout.queueMode === 'docked' ? state.queueOpen : false,
      };
    case 'account':
      return { ...state, account: action.account };
    case 'settings': {
      const theme = resolveTheme(action.settings.theme, state.systemDark);
      return { ...state, settings: action.settings, theme };
    }
    case 'adblock':
      return { ...state, adblock: action.adblock };
    case 'online':
      return { ...state, online: action.online };
    case 'system-dark':
      return { ...state, systemDark: action.dark, theme: resolveTheme(state.settings.theme, action.dark) };
    case 'width':
      return withBreakpoint(state, resolveBreakpoint(action.width));
    case 'sidebar-collapsed':
      return {
        ...state,
        sidebarCollapsed: action.collapsed,
        layout: layoutFor(state.breakpoint, action.collapsed),
      };
    case 'sidebar-drawer':
      return { ...state, sidebarDrawerOpen: state.layout.sidebarMode === 'drawer' ? action.open : false };
    case 'queue-open':
      return { ...state, queueOpen: action.open, volumePopoverOpen: false };
    case 'now-playing':
      return { ...state, nowPlayingOpen: state.layout.compactPlayer ? action.open : false };
    case 'search-overlay':
      return { ...state, searchOverlayOpen: action.open };
    case 'volume-popover':
      return { ...state, volumePopoverOpen: state.layout.volumeMode === 'popover' ? action.open : false };
    case 'modal':
      return { ...state, modal: action.modal };
  }
}

export type Listener = (state: ShellState, prev: ShellState) => void;

export interface Store {
  getState(): ShellState;
  dispatch(action: Action): void;
  subscribe(listener: Listener): () => void;
  select<T>(
    selector: (state: ShellState) => T,
    listener: (value: T, state: ShellState) => void,
    equals?: (a: T, b: T) => boolean,
  ): () => void;
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => Object.is(value, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => Object.is(aRecord[key], bRecord[key]));
}

export function createStore(initial: ShellState): Store {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    dispatch(action: Action): void {
      const prev = state;
      const next = reducer(state, action);
      if (next === prev) {
        return;
      }
      state = next;
      for (const listener of Array.from(listeners)) {
        try {
          listener(state, prev);
        } catch (error) {
          console.error('[store] listener failed', error);
        }
      }
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select<T>(
      selector: (s: ShellState) => T,
      listener: (value: T, s: ShellState) => void,
      equals: (a: T, b: T) => boolean = shallowEqual,
    ): () => void {
      let current = selector(state);
      listener(current, state);
      const wrapped: Listener = (s) => {
        const next = selector(s);
        if (equals(next, current)) {
          return;
        }
        current = next;
        listener(next, s);
      };
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
  };
}

export function displayedPlaying(state: ShellState): boolean {
  if (state.optimisticPlaying !== null) {
    return state.optimisticPlaying;
  }
  return state.player?.isPlaying ?? false;
}

export function activeRoute(state: ShellState): ShellRoute {
  return state.settingsOpen ? 'settings' : state.route;
}
