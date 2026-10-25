import {
  BRIDGE_VERSION,
  type BridgeCommand,
  type BridgeEvent,
  type BridgeState,
  type Lyrics,
} from './contract';
import { CommandRunner, startVideo } from './commands';
import { clickFirst, SEL } from './dom';
import { PlaybackGuard } from './guard';
import { innertube, InnertubeError, readPageConfig, type InnertubeEndpoint } from './innertube';
import { findLyrics, LyricsError, type LyricsQuery, type YtmLyrics } from './lyrics';
import { lyricsBrowseId, parseYtmLyrics } from './parse';
import { PlayerObserver } from './player';
import { detectTransport } from './transport';
import { parseBridgeCommand } from './validate';

export interface MusixBridge {
  readonly version: number;
  receive(input: unknown): boolean;
  state(): BridgeState;
  isReady(): boolean;
  dispose(): void;
}

const READY_POLL_MS = 250;
const LYRICS_TIMEOUT_MS = 6000;
const LYRICS_CACHE_SIZE = 64;

export function installBridge(win: Window, doc: Document): MusixBridge | null {
  const existing = (win as unknown as { __musixBridge?: MusixBridge }).__musixBridge;
  if (existing) {
    return existing;
  }
  if (win.top !== win) {
    return null;
  }
  const emit = (event: BridgeEvent): void => {
    try {
      detectTransport(win).send(JSON.stringify(event));
    } catch {
      return;
    }
  };
  const observer = new PlayerObserver(doc, win, {
    state: (state) => {
      emit({ v: 1, type: 'state', state });
    },
    queue: (items) => {
      emit({ v: 1, type: 'queue', items });
    },
    adStart: () => {
      emit({ v: 1, type: 'adStart' });
    },
    adEnd: () => {
      emit({ v: 1, type: 'adEnd' });
    },
    signedIn: (avatarUrl) => {
      emit({ v: 1, type: 'signedIn', avatarUrl });
    },
    signedOut: () => {
      emit({ v: 1, type: 'signedOut' });
    },
  });
  const request = async (endpoint: InnertubeEndpoint, body: Record<string, unknown>): Promise<unknown> => {
    const config = readPageConfig(win);
    if (!config) {
      throw new InnertubeError('not_ready', 'YouTube Music configuration is not available yet');
    }
    const subtle = (win.crypto as Crypto | undefined)?.subtle;
    if (!subtle) {
      throw new InnertubeError('not_ready', 'Web Crypto is not available');
    }
    return innertube(endpoint, body, {
      fetch: win.fetch.bind(win),
      config,
      cookie: doc.cookie,
      origin: win.location.origin,
      subtle,
      now: () => Date.now(),
    });
  };
  const guard = new PlaybackGuard(doc, win, {
    resumeAnyPause: detectTransport(win).platform === 'ios',
    video: () => observer.videoElement(),
    isAd: () => observer.isAdShowing(),
    resume: () => {
      const player = observer.player();
      if (player && typeof player.playVideo === 'function') {
        player.playVideo();
        return;
      }
      if (clickFirst(observer.findBar(), SEL.playPause)) {
        return;
      }
      startVideo(observer.videoElement());
    },
  });
  observer.setGuard(guard);
  const fetchJson = async (url: string): Promise<unknown> => {
    const controller = new AbortController();
    const timer = win.setTimeout(() => {
      controller.abort();
    }, LYRICS_TIMEOUT_MS);
    try {
      const response = await win.fetch(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new LyricsError(`Lyrics request failed with status ${response.status}`);
      }
      return (await response.json()) as unknown;
    } finally {
      win.clearTimeout(timer);
    }
  };
  const ytmLyrics = async (videoId: string): Promise<YtmLyrics | null> => {
    const browseId = lyricsBrowseId(await request('next', { videoId, isAudioOnly: true }));
    if (!browseId) {
      return null;
    }
    return parseYtmLyrics(await request('browse', { browseId }));
  };
  const lyricsCache = new Map<string, Promise<Lyrics | null>>();
  const lyrics = (query: LyricsQuery): Promise<Lyrics | null> => {
    const key = `${query.videoId}|${Math.round(query.durationSec)}`;
    const cached = lyricsCache.get(key);
    if (cached) {
      return cached;
    }
    const pending = findLyrics(query, { fetchJson, ytm: ytmLyrics });
    lyricsCache.set(key, pending);
    pending.catch(() => {
      lyricsCache.delete(key);
    });
    while (lyricsCache.size > LYRICS_CACHE_SIZE) {
      const oldest = lyricsCache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      lyricsCache.delete(oldest);
    }
    return pending;
  };
  const runner = new CommandRunner({
    doc,
    win,
    observer,
    emit,
    request,
    guard,
    lyrics,
    wait: (ms) =>
      new Promise((resolve) => {
        win.setTimeout(resolve, ms);
      }),
  });
  let ready = false;
  let started = false;
  let disposed = false;
  const pending: BridgeCommand[] = [];
  const runCommand = (command: BridgeCommand): void => {
    runner.run(command).catch(() => undefined);
  };
  const bridge: MusixBridge = {
    version: BRIDGE_VERSION,
    receive(input: unknown): boolean {
      const command = parseBridgeCommand(input);
      if (!command) {
        emit({
          v: 1,
          type: 'error',
          code: 'invalid_command',
          message: 'Command rejected by validation',
          requestId: null,
        });
        return false;
      }
      if (!ready) {
        if (command.type === 'configure' || command.type === 'duck') {
          pending.push(command);
          return true;
        }
        emit({
          v: 1,
          type: 'error',
          code: 'not_ready',
          message: 'Bridge is not ready',
          requestId: command.requestId,
        });
        return false;
      }
      runCommand(command);
      return true;
    },
    state: () => observer.current(),
    isReady: () => ready,
    dispose: () => {
      disposed = true;
      observer.stop();
      guard.stop();
      Reflect.deleteProperty(win, '__musixBridge');
    },
  };
  Object.defineProperty(win, '__musixBridge', {
    value: bridge,
    configurable: true,
    writable: false,
    enumerable: false,
  });

  const checkReady = (): void => {
    if (disposed) {
      return;
    }
    if (!started && doc.readyState !== 'loading') {
      started = true;
      observer.start();
      guard.start();
    }
    if (!ready && started && observer.isReady()) {
      ready = true;
      const config = readPageConfig(win);
      emit({
        v: 1,
        type: 'ready',
        platform: detectTransport(win).platform,
        clientVersion: config ? config.clientVersion : '',
      });
      observer.forceState();
      while (pending.length > 0) {
        const next = pending.shift();
        if (next) {
          runCommand(next);
        }
      }
      return;
    }
    if (!ready) {
      win.setTimeout(checkReady, READY_POLL_MS);
    }
  };
  checkReady();
  return bridge;
}
