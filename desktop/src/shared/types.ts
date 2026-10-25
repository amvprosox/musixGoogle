import type { Lyrics, SearchSuggestions } from '@musix/bridge/contract';

export type { Lyrics, LyricLine, SearchSuggestions } from '@musix/bridge/contract';

export type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';
export type RepeatMode = 'NONE' | 'ALL' | 'ONE';

export interface PlayerState {
  hasTrack: boolean;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  durationSec: number;
  currentTimeSec: number;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  likeStatus: LikeStatus;
  shuffle: boolean;
  repeatMode: RepeatMode;
  videoId: string;
  isAd: boolean;
}

export interface QueueItem {
  index: number;
  thumbnailUrl: string;
  title: string;
  artist: string;
  duration: string;
  isCurrent: boolean;
}

export type NavRoute = 'home' | 'explore' | 'library' | 'liked' | 'playlists';
export type ShellRoute = NavRoute | 'search' | 'settings' | 'other';

export type PlayerCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'togglePlay' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seekTo'; seconds: number }
  | { type: 'setVolume'; volume: number }
  | { type: 'toggleMute' }
  | { type: 'toggleLike' }
  | { type: 'toggleDislike' }
  | { type: 'toggleShuffle' }
  | { type: 'cycleRepeat' }
  | { type: 'playQueueIndex'; index: number }
  | { type: 'playVideo'; videoId: string; playlistId: string | null }
  | { type: 'openBrowse'; browseId: string }
  | { type: 'search'; query: string }
  | { type: 'navigate'; route: NavRoute }
  | { type: 'signIn' }
  | { type: 'openAccountMenu' };

export type PlayerCommandType = PlayerCommand['type'];

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export interface AppSettings {
  theme: ThemePreference;
  closeToTray: boolean;
  startOnLogin: boolean;
  notifyOnTrackChange: boolean;
  adblockEnabled: boolean;
  adSkipFallback: boolean;
  queueOpenOnWideScreens: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  isMaximized: boolean;
  sidebarCollapsed: boolean;
}

export interface ViewLayout {
  bounds: Rect;
  visible: boolean;
}

export type ViewStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; code: number; description: string }
  | { kind: 'crashed'; reason: string }
  | { kind: 'recovering' };

export interface ViewNavState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface AccountState {
  signedIn: boolean;
  avatarUrl: string;
}

export interface AdblockStatus {
  enabled: boolean;
  ready: boolean;
  blockedCount: number;
  lastUpdated: number | null;
  updating: boolean;
  lastError: string | null;
}

export interface KeyPayload {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type DesktopPlatform = 'linux' | 'win32' | 'darwin' | 'other';

export interface BootInfo {
  theme: ResolvedTheme;
  themePreference: ThemePreference;
  sidebarCollapsed: boolean;
  platform: DesktopPlatform;
}

export function desktopPlatform(value: string): DesktopPlatform {
  return value === 'linux' || value === 'win32' || value === 'darwin' ? value : 'other';
}

export interface InitialData {
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

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipRequest {
  text: string;
  anchor: Rect;
  placement: TooltipPlacement;
}

export type ToastVariant = 'success' | 'warning' | 'error' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  message: string;
}

export interface ToastLayerRequest {
  toasts: ToastItem[];
  right: number;
  bottom: number;
}

export interface OverlaySize {
  width: number;
  height: number;
}

export type OverlayRenderPayload =
  | { kind: 'tooltip'; text: string; theme: ResolvedTheme }
  | { kind: 'toasts'; toasts: ToastItem[]; theme: ResolvedTheme; maxWidth: number }
  | { kind: 'menu'; title: string; items: MenuItemSpec[]; theme: ResolvedTheme }
  | { kind: 'clear' };

export type MenuAction =
  | 'playNext'
  | 'addToQueue'
  | 'like'
  | 'goArtist'
  | 'goAlbum'
  | 'copyLink'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll';

export interface MenuItemSpec {
  id: MenuAction;
  label: string;
  icon: string;
  disabled: boolean;
}

export type ItemTarget =
  { kind: 'ytm'; token: string } | { kind: 'queue'; index: number } | { kind: 'player' };

export type MenuTarget = ItemTarget | { kind: 'shellText' } | { kind: 'ytmText' };

export interface ItemMenuInfo {
  title: string;
  actions: MenuAction[];
}

export interface ShellMenuRequest {
  target: { kind: 'queue'; index: number } | { kind: 'player' } | { kind: 'shellText' };
  x: number;
  y: number;
}

export type DesktopViewEvent =
  | {
      type: 'contextMenu';
      target: { kind: 'ytm'; token: string } | { kind: 'ytmText' };
      x: number;
      y: number;
      info: ItemMenuInfo;
    }
  | { type: 'itemInfo'; requestId: string; info: ItemMenuInfo | null }
  | { type: 'link'; url: string }
  | { type: 'tooltip'; text: string; rect: Rect }
  | { type: 'tooltipHide' }
  | { type: 'dialog'; kind: 'alert' | 'confirm' | 'prompt'; message: string }
  | { type: 'navStart' };

export type DesktopViewCommand =
  | { type: 'navigate'; route: NavRoute }
  | { type: 'searchPage'; query: string }
  | { type: 'browsePage'; browseId: string }
  | { type: 'signIn' }
  | { type: 'openAccountMenu' }
  | { type: 'itemInfo'; requestId: string; target: ItemTarget }
  | { type: 'itemAction'; target: ItemTarget; action: MenuAction };

export type WindowControl = 'minimize' | 'toggle-maximize' | 'close';
export type WindowButton = 'minimize' | 'maximize' | 'close';

export interface WindowChromeState {
  maximized: boolean;
  fullscreen: boolean;
  focused: boolean;
  side: 'left' | 'right';
  buttons: WindowButton[];
}

export interface ShellNotice {
  variant: ToastVariant;
  title: string;
  message: string;
}

export interface ShellDialog {
  kind: 'alert' | 'confirm' | 'prompt';
  message: string;
}

export interface YtmConfig {
  adSkipFallback: boolean;
}

export type LyricsResponse =
  | { kind: 'found'; lyrics: Lyrics }
  | { kind: 'missing'; videoId: string }
  | { kind: 'error'; videoId: string; message: string };

export type SuggestResponse = SearchSuggestions | null;

export type AppCommand = 'open-settings' | 'focus-search' | 'toggle-queue';

export type HistoryDirection = 'back' | 'forward';
