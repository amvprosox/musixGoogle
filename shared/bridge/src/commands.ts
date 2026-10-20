import {
  ROOT_NODES,
  SEARCH_FILTER_PARAMS,
  type BridgeCommand,
  type BridgeEvent,
  type RepeatMode,
} from './contract';
import { clickFirst, DOC_SEL, queryFirst, readRepeat, readShuffle, SEL } from './dom';
import { InnertubeError, type InnertubeEndpoint } from './innertube';
import { editSucceeded, isSignedOutResponse, parseAddToPlaylistTargets, parseBrowseResponse } from './parse';
import type { PlayerObserver } from './player';

export type Emit = (event: BridgeEvent) => void;

export interface CommandDeps {
  doc: Document;
  win: Window;
  observer: PlayerObserver;
  emit: Emit;
  request: (endpoint: InnertubeEndpoint, body: Record<string, unknown>) => Promise<unknown>;
  wait: (ms: number) => Promise<void>;
}

class CommandError extends Error {
  constructor(
    readonly code: 'element_missing' | 'not_signed_in' | 'not_ready' | 'network' | 'http' | 'parse',
    message: string,
  ) {
    super(message);
  }
}

export function splitNodeId(nodeId: string): { browseId: string; params: string | null } {
  const mapped = ROOT_NODES[nodeId];
  if (mapped !== undefined) {
    return { browseId: mapped, params: null };
  }
  const index = nodeId.indexOf('|');
  if (index < 0) {
    return { browseId: nodeId, params: null };
  }
  return { browseId: nodeId.slice(0, index), params: nodeId.slice(index + 1) };
}

function dispatchNavigate(win: Window, doc: Document, endpoint: Record<string, unknown>): boolean {
  const app = queryFirst(doc, DOC_SEL.app);
  if (!app) {
    return false;
  }
  const CustomEventCtor = (win as unknown as { CustomEvent: typeof CustomEvent }).CustomEvent;
  app.dispatchEvent(
    new CustomEventCtor('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } }),
  );
  return true;
}

export class CommandRunner {
  constructor(private readonly deps: CommandDeps) {}

  private bar(): Element {
    const bar = this.deps.observer.findBar();
    if (!bar) {
      throw new CommandError('element_missing', 'Player bar not found');
    }
    return bar;
  }

  private click(selectors: readonly string[], label: string): void {
    if (!clickFirst(this.bar(), selectors)) {
      throw new CommandError('element_missing', `${label} control not found`);
    }
  }

  private async waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (check()) {
        return true;
      }
      await this.deps.wait(50);
    }
    return check();
  }

  async run(command: BridgeCommand): Promise<void> {
    const { emit, observer } = this.deps;
    try {
      await this.execute(command);
      observer.scheduleUpdate();
      emit({ v: 1, type: 'ack', requestId: command.requestId });
    } catch (error) {
      if (error instanceof CommandError) {
        emit({ v: 1, type: 'error', code: error.code, message: error.message, requestId: command.requestId });
        return;
      }
      if (error instanceof InnertubeError) {
        emit({ v: 1, type: 'error', code: error.kind, message: error.message, requestId: command.requestId });
        return;
      }
      emit({
        v: 1,
        type: 'error',
        code: 'parse',
        message: error instanceof Error ? error.message : 'Command failed',
        requestId: command.requestId,
      });
    }
  }

  private async execute(command: BridgeCommand): Promise<void> {
    const { observer, doc, win } = this.deps;
    const player = observer.player();
    switch (command.type) {
      case 'play': {
        if (observer.current().isPlaying) {
          return;
        }
        if (!clickFirst(observer.findBar(), SEL.playPause)) {
          if (!player || typeof player.playVideo !== 'function') {
            throw new CommandError('element_missing', 'Play control not found');
          }
          player.playVideo();
        }
        return;
      }
      case 'pause': {
        if (!observer.current().isPlaying) {
          return;
        }
        if (!clickFirst(observer.findBar(), SEL.playPause)) {
          if (!player || typeof player.pauseVideo !== 'function') {
            throw new CommandError('element_missing', 'Pause control not found');
          }
          player.pauseVideo();
        }
        return;
      }
      case 'togglePlay':
        this.click(SEL.playPause, 'Play');
        return;
      case 'next':
        if (!clickFirst(observer.findBar(), SEL.next)) {
          if (!player || typeof player.nextVideo !== 'function') {
            throw new CommandError('element_missing', 'Next control not found');
          }
          player.nextVideo();
        }
        return;
      case 'previous':
        if (!clickFirst(observer.findBar(), SEL.previous)) {
          if (!player || typeof player.previousVideo !== 'function') {
            throw new CommandError('element_missing', 'Previous control not found');
          }
          player.previousVideo();
        }
        return;
      case 'seekTo': {
        const video = observer.videoElement();
        if (!video) {
          throw new CommandError('element_missing', 'No media element');
        }
        const duration = Number.isFinite(video.duration) ? video.duration : command.seconds;
        const target = Math.max(0, Math.min(command.seconds, duration));
        if (player && typeof player.seekTo === 'function') {
          player.seekTo(target, true);
        } else {
          video.currentTime = target;
        }
        return;
      }
      case 'setVolume': {
        const percent = Math.round(command.volume * 100);
        if (player && typeof player.setVolume === 'function') {
          player.setVolume(percent);
          if (
            percent > 0 &&
            typeof player.isMuted === 'function' &&
            player.isMuted() &&
            typeof player.unMute === 'function'
          ) {
            player.unMute();
          }
          const slider = queryFirst(observer.findBar(), SEL.volumeSlider);
          if (slider) {
            (slider as unknown as { value: number }).value = percent;
          }
          return;
        }
        const video = observer.videoElement();
        if (!video) {
          throw new CommandError('element_missing', 'No media element');
        }
        video.volume = percent / 100;
        if (percent > 0) {
          video.muted = false;
        }
        return;
      }
      case 'toggleMute': {
        if (
          player &&
          typeof player.isMuted === 'function' &&
          typeof player.mute === 'function' &&
          typeof player.unMute === 'function'
        ) {
          if (player.isMuted()) {
            player.unMute();
          } else {
            player.mute();
          }
          return;
        }
        if (clickFirst(observer.findBar(), SEL.muteButton)) {
          return;
        }
        const video = observer.videoElement();
        if (!video) {
          throw new CommandError('element_missing', 'No media element');
        }
        video.muted = !video.muted;
        return;
      }
      case 'toggleLike':
        if (observer.current().isAd) {
          return;
        }
        this.click(SEL.likeButton, 'Like');
        return;
      case 'toggleDislike':
        if (observer.current().isAd) {
          return;
        }
        this.click(SEL.dislikeButton, 'Dislike');
        return;
      case 'setShuffle': {
        const bar = this.bar();
        if (readShuffle(bar) === command.enabled) {
          return;
        }
        this.click(SEL.shuffle, 'Shuffle');
        await this.waitFor(() => readShuffle(bar) === command.enabled, 1500);
        return;
      }
      case 'setRepeat': {
        const bar = this.bar();
        const read = (): RepeatMode => readRepeat(bar);
        for (let attempt = 0; attempt < 3 && read() !== command.mode; attempt += 1) {
          const before = read();
          this.click(SEL.repeat, 'Repeat');
          await this.waitFor(() => read() !== before, 1500);
        }
        if (read() !== command.mode) {
          throw new CommandError('element_missing', 'Repeat mode did not change');
        }
        return;
      }
      case 'playVideoId': {
        observer.rememberPlaylist(command.playlistId);
        const watch: Record<string, unknown> = {};
        if (command.videoId !== '') {
          watch.videoId = command.videoId;
        }
        if (command.playlistId) {
          watch.playlistId = command.playlistId;
        }
        if (!dispatchNavigate(win, doc, { watchEndpoint: watch })) {
          const params = new URLSearchParams();
          if (command.videoId !== '') {
            params.set('v', command.videoId);
          }
          if (command.playlistId) {
            params.set('list', command.playlistId);
          }
          win.location.assign(`/watch?${params.toString()}`);
        }
        return;
      }
      case 'playQueueIndex': {
        const item = observer.queueElements()[command.index];
        if (!item) {
          throw new CommandError('element_missing', `Queue item ${command.index} not found`);
        }
        if (!clickFirst(item, DOC_SEL.queuePlayButton)) {
          item.click();
        }
        return;
      }
      case 'browse': {
        const { browseId, params } = splitNodeId(command.nodeId);
        const response = await this.deps.request('browse', params ? { browseId, params } : { browseId });
        this.emitPage('browse', command.requestId, command.nodeId, '', response);
        return;
      }
      case 'search': {
        const params = SEARCH_FILTER_PARAMS[command.filter];
        const response = await this.deps.request(
          'search',
          params ? { query: command.query, params } : { query: command.query },
        );
        this.emitPage(
          'search',
          command.requestId,
          `search:${command.filter}:${command.query}`,
          command.query,
          response,
        );
        return;
      }
      case 'loadContinuation': {
        const response = await this.deps.request(command.kind, { continuation: command.token });
        const query = command.nodeId.startsWith('search:')
          ? command.nodeId.split(':').slice(2).join(':')
          : '';
        this.emitPage(command.kind, command.requestId, command.nodeId, query, response);
        return;
      }
      case 'configure':
        observer.setAdSkip(command.adSkip);
        return;
      case 'duck':
        observer.setDuck(command.level);
        return;
      case 'playlistTargets': {
        this.requireAccount();
        const response = await this.deps.request('playlist/get_add_to_playlist', {
          videoIds: [command.videoId],
          excludeWatchLater: true,
        });
        this.deps.emit({
          v: 1,
          type: 'browseResult',
          requestId: command.requestId,
          page: parseAddToPlaylistTargets(response, command.videoId),
        });
        return;
      }
      case 'addToPlaylist': {
        this.requireAccount();
        const response = await this.deps.request('browse/edit_playlist', {
          playlistId: command.playlistId,
          actions: [
            { action: 'ACTION_ADD_VIDEO', addedVideoId: command.videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' },
          ],
        });
        if (!editSucceeded(response)) {
          throw new CommandError('http', 'YouTube Music could not save the song to that playlist');
        }
        return;
      }
      case 'savePlaylist': {
        this.requireAccount();
        await this.deps.request(command.save ? 'like/like' : 'like/removelike', {
          target: { playlistId: command.playlistId },
        });
        return;
      }
    }
  }

  private requireAccount(): void {
    if (!this.deps.observer.current().isSignedIn) {
      throw new CommandError('not_signed_in', 'Sign in to YouTube Music to save music');
    }
  }

  private emitPage(
    kind: 'browse' | 'search',
    requestId: string,
    nodeId: string,
    query: string,
    response: unknown,
  ): void {
    const page = parseBrowseResponse(response, nodeId);
    const empty = page.items.length === 0 && page.sections.length === 0;
    if (empty && isSignedOutResponse(response) && kind === 'browse') {
      throw new CommandError('not_signed_in', 'Sign in to see this content');
    }
    if (kind === 'search') {
      this.deps.emit({ v: 1, type: 'searchResult', requestId, query, page });
      return;
    }
    this.deps.emit({ v: 1, type: 'browseResult', requestId, page });
  }
}
