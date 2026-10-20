import type { BridgeCommand, BridgeState, QueueEntry } from '@musix/bridge/contract';
import { formatTime } from './format';
import { nextRepeatMode } from './player-math';
import type { DesktopViewCommand, PlayerCommand, PlayerState, QueueItem } from './types';

export function toPlayerState(state: BridgeState): PlayerState {
  return {
    hasTrack: state.title !== '',
    title: state.title,
    artist: state.artist,
    album: state.album,
    artworkUrl: state.artworkUrl,
    durationSec: state.durationSec,
    currentTimeSec: state.positionSec,
    isPlaying: state.isPlaying,
    volume: state.volume,
    isMuted: state.isMuted,
    likeStatus: state.likeStatus,
    shuffle: state.shuffle,
    repeatMode: state.repeatMode,
    videoId: state.videoId.length <= 64 ? state.videoId : '',
    isAd: state.isAd,
  };
}

export function toQueueItems(entries: readonly QueueEntry[]): QueueItem[] {
  return entries.map((entry) => ({
    index: entry.index,
    thumbnailUrl: entry.artworkUrl,
    title: entry.title,
    artist: entry.artist,
    duration: entry.durationSec > 0 ? formatTime(entry.durationSec) : '',
    isCurrent: entry.isCurrent,
  }));
}

export type RoutedCommand =
  { channel: 'bridge'; command: BridgeCommand } | { channel: 'desktop'; command: DesktopViewCommand };

export function routeCommand(
  command: PlayerCommand,
  current: PlayerState | null,
  requestId: string,
): RoutedCommand {
  const base = { v: 1 as const, requestId };
  switch (command.type) {
    case 'play':
    case 'pause':
    case 'togglePlay':
    case 'next':
    case 'previous':
    case 'toggleMute':
    case 'toggleLike':
    case 'toggleDislike':
      return { channel: 'bridge', command: { ...base, type: command.type } };
    case 'seekTo':
      return { channel: 'bridge', command: { ...base, type: 'seekTo', seconds: command.seconds } };
    case 'setVolume':
      return { channel: 'bridge', command: { ...base, type: 'setVolume', volume: command.volume } };
    case 'toggleShuffle':
      return {
        channel: 'bridge',
        command: { ...base, type: 'setShuffle', enabled: !(current?.shuffle ?? false) },
      };
    case 'cycleRepeat':
      return {
        channel: 'bridge',
        command: { ...base, type: 'setRepeat', mode: nextRepeatMode(current?.repeatMode ?? 'NONE') },
      };
    case 'playQueueIndex':
      return { channel: 'bridge', command: { ...base, type: 'playQueueIndex', index: command.index } };
    case 'search':
      return { channel: 'desktop', command: { type: 'searchPage', query: command.query } };
    case 'navigate':
      return { channel: 'desktop', command: { type: 'navigate', route: command.route } };
    case 'signIn':
      return { channel: 'desktop', command: { type: 'signIn' } };
    case 'openAccountMenu':
      return { channel: 'desktop', command: { type: 'openAccountMenu' } };
  }
}

export function parseButtonLayout(raw: string): {
  side: 'left' | 'right';
  buttons: ('minimize' | 'maximize' | 'close')[];
} {
  const cleaned = raw.trim().replace(/^'+|'+$/g, '');
  const [left = '', right = ''] = cleaned.split(':');
  const pick = (part: string): ('minimize' | 'maximize' | 'close')[] =>
    part
      .split(',')
      .map((entry) => entry.trim())
      .filter(
        (entry): entry is 'minimize' | 'maximize' | 'close' =>
          entry === 'minimize' || entry === 'maximize' || entry === 'close',
      );
  const leftButtons = pick(left);
  const rightButtons = pick(right);
  if (leftButtons.includes('close') || (leftButtons.length > 0 && rightButtons.length === 0)) {
    return {
      side: 'left',
      buttons: leftButtons.length > 0 ? leftButtons : ['close', 'minimize', 'maximize'],
    };
  }
  if (rightButtons.length > 0) {
    return { side: 'right', buttons: rightButtons };
  }
  return { side: 'right', buttons: ['minimize', 'maximize', 'close'] };
}
