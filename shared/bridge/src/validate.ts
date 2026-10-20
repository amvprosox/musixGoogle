import {
  BRIDGE_VERSION,
  type BridgeCommand,
  type BridgeErrorCode,
  type BridgeEvent,
  type BridgeState,
  type BrowsePage,
  type FlatItem,
  type FlatSection,
  type ItemType,
  type QueueEntry,
  type SearchFilter,
} from './contract';

const MAX_TEXT = 2000;
const MAX_ID = 512;
const MAX_URL = 4096;
const MAX_TOKEN = 8192;
const MAX_ITEMS = 2000;

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function num(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function bool(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function nullableStr(value: unknown, max: number): value is string | null {
  return value === null || str(value, max);
}

function requestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

const ITEM_TYPES: readonly ItemType[] = ['song', 'video', 'album', 'playlist', 'artist', 'shelf'];
const FILTERS: readonly SearchFilter[] = ['all', 'songs', 'videos', 'albums', 'playlists', 'artists'];
const ERROR_CODES: readonly BridgeErrorCode[] = [
  'not_ready',
  'not_signed_in',
  'network',
  'http',
  'parse',
  'invalid_command',
  'unsupported',
  'element_missing',
];

export function isBridgeState(value: unknown): value is BridgeState {
  if (!isRecord(value)) {
    return false;
  }
  return (
    str(value.videoId, MAX_ID) &&
    str(value.playlistId, MAX_ID) &&
    str(value.title, MAX_TEXT) &&
    str(value.artist, MAX_TEXT) &&
    str(value.album, MAX_TEXT) &&
    str(value.artworkUrl, MAX_URL) &&
    (value.artworkUrl === '' || value.artworkUrl.startsWith('https://')) &&
    num(value.durationSec) &&
    value.durationSec >= 0 &&
    num(value.positionSec) &&
    value.positionSec >= 0 &&
    num(value.bufferedSec) &&
    value.bufferedSec >= 0 &&
    bool(value.isPlaying) &&
    bool(value.isBuffering) &&
    num(value.volume) &&
    value.volume >= 0 &&
    value.volume <= 1 &&
    bool(value.isMuted) &&
    (value.likeStatus === 'LIKE' || value.likeStatus === 'DISLIKE' || value.likeStatus === 'INDIFFERENT') &&
    bool(value.shuffle) &&
    (value.repeatMode === 'NONE' || value.repeatMode === 'ALL' || value.repeatMode === 'ONE') &&
    bool(value.isAd) &&
    bool(value.isSignedIn)
  );
}

export function isQueueEntry(value: unknown): value is QueueEntry {
  return (
    isRecord(value) &&
    num(value.index) &&
    Number.isInteger(value.index) &&
    value.index >= 0 &&
    str(value.videoId, MAX_ID) &&
    str(value.title, MAX_TEXT) &&
    str(value.artist, MAX_TEXT) &&
    str(value.artworkUrl, MAX_URL) &&
    num(value.durationSec) &&
    value.durationSec >= 0 &&
    bool(value.isCurrent)
  );
}

export function isFlatItem(value: unknown): value is FlatItem {
  return (
    isRecord(value) &&
    str(value.id, MAX_TOKEN) &&
    value.id.length > 0 &&
    str(value.title, MAX_TEXT) &&
    str(value.subtitle, MAX_TEXT) &&
    str(value.artworkUrl, MAX_URL) &&
    typeof value.type === 'string' &&
    (ITEM_TYPES as readonly string[]).includes(value.type) &&
    bool(value.playable) &&
    bool(value.browsable) &&
    nullableStr(value.videoId, MAX_ID) &&
    nullableStr(value.playlistId, MAX_ID) &&
    nullableStr(value.browseId, MAX_TOKEN) &&
    (value.durationSec === null || (num(value.durationSec) && value.durationSec >= 0)) &&
    nullableStr(value.continuation, MAX_TOKEN)
  );
}

export function isFlatSection(value: unknown): value is FlatSection {
  return (
    isRecord(value) &&
    str(value.id, MAX_TOKEN) &&
    str(value.title, MAX_TEXT) &&
    nullableStr(value.browseId, MAX_TOKEN) &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_ITEMS &&
    value.items.every(isFlatItem)
  );
}

export function isBrowsePage(value: unknown): value is BrowsePage {
  return (
    isRecord(value) &&
    str(value.nodeId, MAX_TOKEN) &&
    str(value.title, MAX_TEXT) &&
    Array.isArray(value.sections) &&
    value.sections.length <= 200 &&
    value.sections.every(isFlatSection) &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_ITEMS &&
    value.items.every(isFlatItem) &&
    nullableStr(value.continuation, MAX_TOKEN)
  );
}

export function isBridgeEvent(value: unknown): value is BridgeEvent {
  if (!isRecord(value) || value.v !== BRIDGE_VERSION || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'ready':
      return (
        (value.platform === 'electron' ||
          value.platform === 'android' ||
          value.platform === 'ios' ||
          value.platform === 'none') &&
        str(value.clientVersion, 64)
      );
    case 'state':
      return isBridgeState(value.state);
    case 'queue':
      return Array.isArray(value.items) && value.items.length <= MAX_ITEMS && value.items.every(isQueueEntry);
    case 'browseResult':
      return requestId(value.requestId) && isBrowsePage(value.page);
    case 'searchResult':
      return requestId(value.requestId) && str(value.query, 500) && isBrowsePage(value.page);
    case 'signedIn':
      return str(value.avatarUrl, MAX_URL);
    case 'signedOut':
    case 'adStart':
    case 'adEnd':
      return true;
    case 'ack':
      return requestId(value.requestId);
    case 'error':
      return (
        typeof value.code === 'string' &&
        (ERROR_CODES as readonly string[]).includes(value.code) &&
        str(value.message, MAX_TEXT) &&
        (value.requestId === null || requestId(value.requestId))
      );
    default:
      return false;
  }
}

export function isBridgeCommand(value: unknown): value is BridgeCommand {
  if (
    !isRecord(value) ||
    value.v !== BRIDGE_VERSION ||
    typeof value.type !== 'string' ||
    !requestId(value.requestId)
  ) {
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
      return true;
    case 'seekTo':
      return num(value.seconds) && value.seconds >= 0;
    case 'setVolume':
      return num(value.volume) && value.volume >= 0 && value.volume <= 1;
    case 'setShuffle':
      return bool(value.enabled);
    case 'setRepeat':
      return value.mode === 'NONE' || value.mode === 'ALL' || value.mode === 'ONE';
    case 'playVideoId':
      return (
        typeof value.videoId === 'string' &&
        (value.playlistId === null ||
          (typeof value.playlistId === 'string' && /^[A-Za-z0-9_-]{2,128}$/.test(value.playlistId))) &&
        (/^[A-Za-z0-9_-]{6,20}$/.test(value.videoId) || (value.videoId === '' && value.playlistId !== null))
      );
    case 'playQueueIndex':
      return num(value.index) && Number.isInteger(value.index) && value.index >= 0 && value.index < MAX_ITEMS;
    case 'browse':
      return str(value.nodeId, MAX_TOKEN) && value.nodeId.length > 0;
    case 'search':
      return (
        str(value.query, 500) &&
        value.query.trim().length > 0 &&
        typeof value.filter === 'string' &&
        (FILTERS as readonly string[]).includes(value.filter)
      );
    case 'loadContinuation':
      return (
        str(value.token, MAX_TOKEN) &&
        value.token.length > 0 &&
        (value.kind === 'browse' || value.kind === 'search') &&
        str(value.nodeId, MAX_TOKEN)
      );
    case 'configure':
      return bool(value.adSkip);
    case 'duck':
      return num(value.level) && value.level >= 0 && value.level <= 1;
    default:
      return false;
  }
}

export function parseBridgeEvent(json: string): BridgeEvent | null {
  try {
    const value: unknown = JSON.parse(json);
    return isBridgeEvent(value) ? value : null;
  } catch {
    return null;
  }
}

export function parseBridgeCommand(input: unknown): BridgeCommand | null {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return null;
    }
  }
  return isBridgeCommand(value) ? value : null;
}
