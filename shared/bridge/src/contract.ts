export const BRIDGE_VERSION = 1;

export type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';
export type RepeatMode = 'NONE' | 'ALL' | 'ONE';
export type ItemType = 'song' | 'video' | 'album' | 'playlist' | 'artist' | 'shelf';
export type SearchFilter = 'all' | 'songs' | 'videos' | 'albums' | 'playlists' | 'artists';
export type Platform = 'electron' | 'android' | 'ios' | 'none';

export interface BridgeState {
  videoId: string;
  playlistId: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
  durationSec: number;
  positionSec: number;
  bufferedSec: number;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  isMuted: boolean;
  likeStatus: LikeStatus;
  shuffle: boolean;
  repeatMode: RepeatMode;
  isAd: boolean;
  isSignedIn: boolean;
}

export interface QueueEntry {
  index: number;
  videoId: string;
  title: string;
  artist: string;
  artworkUrl: string;
  durationSec: number;
  isCurrent: boolean;
}

export interface FlatItem {
  id: string;
  title: string;
  subtitle: string;
  artworkUrl: string;
  type: ItemType;
  playable: boolean;
  browsable: boolean;
  videoId: string | null;
  playlistId: string | null;
  browseId: string | null;
  durationSec: number | null;
  continuation: string | null;
}

export interface FlatSection {
  id: string;
  title: string;
  browseId: string | null;
  items: FlatItem[];
}

export interface BrowsePage {
  nodeId: string;
  title: string;
  sections: FlatSection[];
  items: FlatItem[];
  continuation: string | null;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface Lyrics {
  videoId: string;
  source: string;
  synced: boolean;
  instrumental: boolean;
  lines: LyricLine[];
}

export interface SearchSuggestions {
  query: string;
  queries: string[];
  items: FlatItem[];
}

export type BridgeEvent =
  | { v: 1; type: 'ready'; platform: Platform; clientVersion: string }
  | { v: 1; type: 'state'; state: BridgeState }
  | { v: 1; type: 'queue'; items: QueueEntry[] }
  | { v: 1; type: 'browseResult'; requestId: string; page: BrowsePage }
  | { v: 1; type: 'searchResult'; requestId: string; query: string; page: BrowsePage }
  | { v: 1; type: 'signedIn'; avatarUrl: string }
  | { v: 1; type: 'signedOut' }
  | { v: 1; type: 'adStart' }
  | { v: 1; type: 'adEnd' }
  | { v: 1; type: 'ack'; requestId: string }
  | { v: 1; type: 'lyricsResult'; requestId: string; lyrics: Lyrics | null }
  | { v: 1; type: 'suggestResult'; requestId: string; suggestions: SearchSuggestions }
  | { v: 1; type: 'error'; code: BridgeErrorCode; message: string; requestId: string | null };

export type BridgeErrorCode =
  | 'not_ready'
  | 'not_signed_in'
  | 'network'
  | 'http'
  | 'parse'
  | 'invalid_command'
  | 'unsupported'
  | 'element_missing';

export type BridgeCommand =
  | { v: 1; type: 'play'; requestId: string }
  | { v: 1; type: 'pause'; requestId: string }
  | { v: 1; type: 'togglePlay'; requestId: string }
  | { v: 1; type: 'next'; requestId: string }
  | { v: 1; type: 'previous'; requestId: string }
  | { v: 1; type: 'seekTo'; requestId: string; seconds: number }
  | { v: 1; type: 'setVolume'; requestId: string; volume: number }
  | { v: 1; type: 'toggleMute'; requestId: string }
  | { v: 1; type: 'toggleLike'; requestId: string }
  | { v: 1; type: 'toggleDislike'; requestId: string }
  | { v: 1; type: 'setShuffle'; requestId: string; enabled: boolean }
  | { v: 1; type: 'setRepeat'; requestId: string; mode: RepeatMode }
  | { v: 1; type: 'playVideoId'; requestId: string; videoId: string; playlistId: string | null }
  | { v: 1; type: 'playQueueIndex'; requestId: string; index: number }
  | { v: 1; type: 'browse'; requestId: string; nodeId: string }
  | { v: 1; type: 'search'; requestId: string; query: string; filter: SearchFilter }
  | {
      v: 1;
      type: 'loadContinuation';
      requestId: string;
      token: string;
      kind: 'browse' | 'search';
      nodeId: string;
    }
  | { v: 1; type: 'configure'; requestId: string; adSkip: boolean }
  | { v: 1; type: 'duck'; requestId: string; level: number }
  | { v: 1; type: 'playlistTargets'; requestId: string; videoId: string }
  | { v: 1; type: 'addToPlaylist'; requestId: string; videoId: string; playlistId: string }
  | { v: 1; type: 'savePlaylist'; requestId: string; playlistId: string; save: boolean }
  | {
      v: 1;
      type: 'lyrics';
      requestId: string;
      videoId: string;
      title: string;
      artist: string;
      album: string;
      durationSec: number;
    }
  | { v: 1; type: 'suggest'; requestId: string; query: string };

export type BridgeCommandType = BridgeCommand['type'];
export type BridgeEventType = BridgeEvent['type'];

export const ROOT_NODES: Readonly<Record<string, string>> = {
  home: 'FEmusic_home',
  explore: 'FEmusic_explore',
  'library-liked': 'VLLM',
  'library-albums': 'FEmusic_liked_albums',
  'library-artists': 'FEmusic_library_corpus_track_artists',
  playlists: 'FEmusic_liked_playlists',
  recent: 'FEmusic_history',
};

export const SEARCH_FILTER_PARAMS: Readonly<Record<SearchFilter, string | null>> = {
  all: null,
  songs: 'EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQFQ%3D%3D',
  videos: 'EgWKAQIQAWoQEAMQBBAJEAoQBRAREBAQFQ%3D%3D',
  albums: 'EgWKAQIYAWoQEAMQBBAJEAoQBRAREBAQFQ%3D%3D',
  playlists: 'EgeKAQQoAEABahAQAxAEEAkQChAFEBEQEBAV',
  artists: 'EgWKAQIgAWoQEAMQBBAJEAoQBRAREBAQFQ%3D%3D',
};

export const EMPTY_STATE: Readonly<BridgeState> = {
  videoId: '',
  playlistId: '',
  title: '',
  artist: '',
  album: '',
  artworkUrl: '',
  durationSec: 0,
  positionSec: 0,
  bufferedSec: 0,
  isPlaying: false,
  isBuffering: false,
  volume: 1,
  isMuted: false,
  likeStatus: 'INDIFFERENT',
  shuffle: false,
  repeatMode: 'NONE',
  isAd: false,
  isSignedIn: false,
};
