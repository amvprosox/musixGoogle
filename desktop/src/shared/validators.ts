import {
  isBoolean,
  isBoundedString,
  isFiniteNumber,
  isNonNegativeInteger,
  isRecord,
  isString,
} from './guards';
import { isNavRoute, MAX_QUERY_LENGTH } from './routes';
import type {
  AccountState,
  DesktopViewEvent,
  ItemMenuInfo,
  MenuAction,
  ShellMenuRequest,
  WindowControl,
  HistoryDirection,
  KeyPayload,
  LikeStatus,
  OverlayRenderPayload,
  OverlaySize,
  PlayerCommand,
  PlayerState,
  QueueItem,
  Rect,
  RepeatMode,
  ToastItem,
  ToastLayerRequest,
  TooltipRequest,
  ViewLayout,
} from './types';

const MAX_TEXT = 2000;
const MAX_URL = 4096;
const MAX_QUEUE = 1000;
const MAX_DIMENSION = 100000;

export function isLikeStatus(value: unknown): value is LikeStatus {
  return value === 'LIKE' || value === 'DISLIKE' || value === 'INDIFFERENT';
}

export function isRepeatMode(value: unknown): value is RepeatMode {
  return value === 'NONE' || value === 'ALL' || value === 'ONE';
}

export function isRect(value: unknown): value is Rect {
  if (!isRecord(value)) {
    return false;
  }
  const { x, y, width, height } = value;
  return (
    isFiniteNumber(x) &&
    isFiniteNumber(y) &&
    isFiniteNumber(width) &&
    isFiniteNumber(height) &&
    width >= 0 &&
    height >= 0 &&
    Math.abs(x) <= MAX_DIMENSION &&
    Math.abs(y) <= MAX_DIMENSION &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION
  );
}

export function isViewLayout(value: unknown): value is ViewLayout {
  return isRecord(value) && isRect(value.bounds) && isBoolean(value.visible);
}

export function isPlayerCommand(value: unknown): value is PlayerCommand {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }
  switch (value.type) {
    case 'play':
    case 'pause':
    case 'togglePlay':
    case 'next':
    case 'previous':
    case 'toggleMute':
    case 'toggleLike':
    case 'toggleDislike':
    case 'toggleShuffle':
    case 'cycleRepeat':
    case 'signIn':
    case 'openAccountMenu':
      return true;
    case 'seekTo':
      return isFiniteNumber(value.seconds) && value.seconds >= 0;
    case 'setVolume':
      return isFiniteNumber(value.volume) && value.volume >= 0 && value.volume <= 1;
    case 'playQueueIndex':
      return isNonNegativeInteger(value.index) && value.index < MAX_QUEUE;
    case 'search':
      return isBoundedString(value.query, MAX_QUERY_LENGTH) && value.query.trim().length > 0;
    case 'navigate':
      return isNavRoute(value.route);
    case 'playVideo':
      return (
        isString(value.videoId) &&
        /^[A-Za-z0-9_-]{6,20}$/.test(value.videoId) &&
        (value.playlistId === null ||
          (isString(value.playlistId) && /^[A-Za-z0-9_-]{2,128}$/.test(value.playlistId)))
      );
    case 'openBrowse':
      return isString(value.browseId) && /^[A-Za-z0-9_-]{2,200}$/.test(value.browseId);
    default:
      return false;
  }
}

export function isPlayerState(value: unknown): value is PlayerState {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isBoolean(value.hasTrack) &&
    isBoundedString(value.title, MAX_TEXT) &&
    isBoundedString(value.artist, MAX_TEXT) &&
    isBoundedString(value.album, MAX_TEXT) &&
    isBoundedString(value.artworkUrl, MAX_URL) &&
    isFiniteNumber(value.durationSec) &&
    value.durationSec >= 0 &&
    isFiniteNumber(value.currentTimeSec) &&
    value.currentTimeSec >= 0 &&
    isBoolean(value.isPlaying) &&
    isFiniteNumber(value.volume) &&
    value.volume >= 0 &&
    value.volume <= 1 &&
    isBoolean(value.isMuted) &&
    isLikeStatus(value.likeStatus) &&
    isBoolean(value.shuffle) &&
    isRepeatMode(value.repeatMode) &&
    isBoundedString(value.videoId, 64) &&
    isBoolean(value.isAd)
  );
}

export function isQueueItem(value: unknown): value is QueueItem {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonNegativeInteger(value.index) &&
    isBoundedString(value.thumbnailUrl, MAX_URL) &&
    isBoundedString(value.title, MAX_TEXT) &&
    isBoundedString(value.artist, MAX_TEXT) &&
    isBoundedString(value.duration, 32) &&
    isBoolean(value.isCurrent)
  );
}

export function isQueueItems(value: unknown): value is QueueItem[] {
  return Array.isArray(value) && value.length <= MAX_QUEUE && value.every(isQueueItem);
}

export function isAccountState(value: unknown): value is AccountState {
  return isRecord(value) && isBoolean(value.signedIn) && isBoundedString(value.avatarUrl, MAX_URL);
}

export function isKeyPayload(value: unknown): value is KeyPayload {
  return (
    isRecord(value) &&
    isBoundedString(value.key, 32) &&
    isBoundedString(value.code, 32) &&
    isBoolean(value.ctrlKey) &&
    isBoolean(value.shiftKey) &&
    isBoolean(value.altKey) &&
    isBoolean(value.metaKey)
  );
}

export function isHistoryDirection(value: unknown): value is HistoryDirection {
  return value === 'back' || value === 'forward';
}

export function isTooltipRequest(value: unknown): value is TooltipRequest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isBoundedString(value.text, 200) &&
    value.text.length > 0 &&
    isRect(value.anchor) &&
    (value.placement === 'top' ||
      value.placement === 'bottom' ||
      value.placement === 'left' ||
      value.placement === 'right')
  );
}

export function isToastItem(value: unknown): value is ToastItem {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isBoundedString(value.id, 64) &&
    (value.variant === 'success' ||
      value.variant === 'warning' ||
      value.variant === 'error' ||
      value.variant === 'info') &&
    isBoundedString(value.title, 200) &&
    isBoundedString(value.message, 500)
  );
}

export function isToastLayerRequest(value: unknown): value is ToastLayerRequest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.toasts) &&
    value.toasts.length <= 10 &&
    value.toasts.every(isToastItem) &&
    isFiniteNumber(value.right) &&
    isFiniteNumber(value.bottom) &&
    value.right >= 0 &&
    value.bottom >= 0
  );
}

export function isOverlaySize(value: unknown): value is OverlaySize {
  return (
    isRecord(value) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width >= 0 &&
    value.height >= 0 &&
    value.width <= MAX_DIMENSION &&
    value.height <= MAX_DIMENSION
  );
}

export function isOverlayRenderPayload(value: unknown): value is OverlayRenderPayload {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === 'clear') {
    return true;
  }
  const themeOk = value.theme === 'light' || value.theme === 'dark';
  if (value.kind === 'tooltip') {
    return themeOk && isBoundedString(value.text, 200);
  }
  if (value.kind === 'toasts') {
    return (
      themeOk &&
      isFiniteNumber(value.maxWidth) &&
      value.maxWidth > 0 &&
      Array.isArray(value.toasts) &&
      value.toasts.every(isToastItem)
    );
  }
  return false;
}

export function isNull(value: unknown): value is null {
  return value === null || value === undefined;
}

const MENU_ACTIONS: readonly MenuAction[] = [
  'playNext',
  'addToQueue',
  'like',
  'goArtist',
  'goAlbum',
  'copyLink',
  'cut',
  'copy',
  'paste',
  'selectAll',
];

export function isMenuAction(value: unknown): value is MenuAction {
  return typeof value === 'string' && (MENU_ACTIONS as readonly string[]).includes(value);
}

export function isItemMenuInfo(value: unknown): value is ItemMenuInfo {
  return (
    isRecord(value) &&
    isBoundedString(value.title, 500) &&
    Array.isArray(value.actions) &&
    value.actions.length <= MENU_ACTIONS.length &&
    value.actions.every(isMenuAction)
  );
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]{4,32}$/.test(value);
}

export function isDesktopViewEvent(value: unknown): value is DesktopViewEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'contextMenu': {
      const target = value.target;
      const targetOk =
        isRecord(target) && ((target.kind === 'ytm' && isToken(target.token)) || target.kind === 'ytmText');
      return targetOk && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isItemMenuInfo(value.info);
    }
    case 'itemInfo':
      return isBoundedString(value.requestId, 64) && (value.info === null || isItemMenuInfo(value.info));
    case 'link':
      return isBoundedString(value.url, 2048) && value.url.startsWith('https://music.youtube.com/');
    case 'tooltip':
      return isBoundedString(value.text, 200) && value.text.trim() !== '' && isRect(value.rect);
    case 'tooltipHide':
    case 'navStart':
      return true;
    case 'dialog':
      return (
        (value.kind === 'alert' || value.kind === 'confirm' || value.kind === 'prompt') &&
        isBoundedString(value.message, 2000)
      );
    default:
      return false;
  }
}

export function isWindowControl(value: unknown): value is WindowControl {
  return value === 'minimize' || value === 'toggle-maximize' || value === 'close';
}

export function isShellMenuRequest(value: unknown): value is ShellMenuRequest {
  if (!isRecord(value) || !isRecord(value.target) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return false;
  }
  const target = value.target;
  if (target.kind === 'queue') {
    return isNonNegativeInteger(target.index) && target.index < MAX_QUEUE;
  }
  return target.kind === 'player' || target.kind === 'shellText';
}
