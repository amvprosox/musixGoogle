import { createRequire } from 'node:module';
import type { MprisPlayer, PlayerOptions } from 'mpris-service';
import dbus from 'dbus-next';
import { APP_DESKTOP_NAME, APP_NAME, MPRIS_DETECT_MS } from '../shared/constants';
import { decideMpris } from '../shared/policies';
import type { PlayerCommand, PlayerState, RepeatMode } from '../shared/types';
import { logInfo, logWarn } from './log';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const FALLBACK_NAME = 'musix';
const RECHECK_MS = 10000;

interface DbusInterface {
  ListNames(): Promise<string[]>;
  GetConnectionUnixProcessID(name: string): Promise<number>;
}

interface PrivateBus {
  _bus?: { disconnect: () => void };
}

type CommandSink = (command: PlayerCommand) => void;

type PlayerCtor = new (options: PlayerOptions) => MprisPlayer;

function resolvePlayerConstructor(loaded: unknown): PlayerCtor | null {
  if (typeof loaded === 'function') {
    return loaded as PlayerCtor;
  }
  if (typeof loaded === 'object' && loaded !== null) {
    const candidate = (loaded as { default?: unknown }).default;
    if (typeof candidate === 'function') {
      return candidate as PlayerCtor;
    }
  }
  return null;
}

function loopStatusFor(mode: RepeatMode): 'None' | 'Track' | 'Playlist' {
  if (mode === 'ONE') {
    return 'Track';
  }
  if (mode === 'ALL') {
    return 'Playlist';
  }
  return 'None';
}

export class MprisManager {
  private bus: dbus.MessageBus | null = null;
  private fallback: MprisPlayer | null = null;
  private state: PlayerState | null = null;
  private playbackStartedAt: number | null = null;
  private chromiumDetected = false;
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;
  private checking = false;

  constructor(
    private readonly sink: CommandSink,
    private readonly raise: () => void,
  ) {}

  update(state: PlayerState): void {
    this.state = state;
    if (state.isPlaying && this.playbackStartedAt === null) {
      this.playbackStartedAt = Date.now();
      this.schedule(MPRIS_DETECT_MS);
    }
    this.syncFallback();
  }

  private schedule(delay: number): void {
    if (this.disposed) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.evaluate().catch((error: unknown) => {
        logWarn('mpris', 'Evaluation failed', error);
      });
    }, delay);
  }

  private async evaluate(): Promise<void> {
    if (this.disposed || this.checking) {
      return;
    }
    this.checking = true;
    try {
      this.chromiumDetected = await this.detectChromium();
    } finally {
      this.checking = false;
    }
    const decision = decideMpris({
      chromiumDetected: this.chromiumDetected,
      fallbackActive: this.fallback !== null,
      playbackStartedAt: this.playbackStartedAt,
      now: Date.now(),
      detectWindowMs: MPRIS_DETECT_MS,
    });
    if (decision === 'start-fallback') {
      logInfo('mpris', 'Chromium media session not detected, starting mpris-service fallback');
      this.startFallback();
    }
    if (decision === 'stop-fallback') {
      logInfo('mpris', 'Chromium media session detected, stopping fallback to avoid duplicates');
      this.stopFallback();
    }
    if (this.fallback !== null || !this.chromiumDetected) {
      this.schedule(RECHECK_MS);
    }
  }

  private getBus(): dbus.MessageBus | null {
    if (this.bus) {
      return this.bus;
    }
    try {
      this.bus = dbus.sessionBus();
      this.bus.on('error', (error: unknown) => {
        logWarn('mpris', 'Session bus error', error);
      });
      return this.bus;
    } catch (error) {
      logWarn('mpris', 'Session bus unavailable', error);
      return null;
    }
  }

  async detectChromium(): Promise<boolean> {
    const bus = this.getBus();
    if (!bus) {
      return false;
    }
    try {
      const proxy = await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus');
      const iface = proxy.getInterface('org.freedesktop.DBus') as unknown as DbusInterface;
      const names = await iface.ListNames();
      const candidates = names.filter(
        (name) => name.startsWith(MPRIS_PREFIX) && !name.startsWith(`${MPRIS_PREFIX}${FALLBACK_NAME}`),
      );
      for (const name of candidates) {
        try {
          const pid = await iface.GetConnectionUnixProcessID(name);
          if (pid === process.pid) {
            return true;
          }
        } catch (error) {
          logWarn('mpris', `PID lookup failed for ${name}`, error);
        }
      }
      return false;
    } catch (error) {
      logWarn('mpris', 'MPRIS detection failed', error);
      return false;
    }
  }

  private startFallback(): void {
    if (this.fallback || this.disposed) {
      return;
    }
    try {
      const require = createRequire(import.meta.url);
      const loaded: unknown = require('mpris-service');
      const Player = resolvePlayerConstructor(loaded);
      if (!Player) {
        logWarn('mpris', 'mpris-service export not recognised');
        return;
      }
      const player = new Player({
        name: FALLBACK_NAME,
        identity: APP_NAME,
        supportedUriSchemes: [],
        supportedMimeTypes: [],
        supportedInterfaces: ['player'],
        desktopEntry: APP_DESKTOP_NAME,
      });
      player.canRaise = true;
      player.canQuit = false;
      player.canSeek = true;
      player.canControl = true;
      player.canGoNext = true;
      player.canGoPrevious = true;
      player.canPlay = true;
      player.canPause = true;
      player.getPosition = () => Math.round((this.state?.currentTimeSec ?? 0) * 1e6);
      player.on('error', (error: unknown) => {
        logWarn('mpris', 'Fallback player error', error);
      });
      player.on('play', () => {
        this.sink({ type: 'play' });
      });
      player.on('pause', () => {
        this.sink({ type: 'pause' });
      });
      player.on('playpause', () => {
        this.sink({ type: 'togglePlay' });
      });
      player.on('stop', () => {
        this.sink({ type: 'pause' });
      });
      player.on('next', () => {
        this.sink({ type: 'next' });
      });
      player.on('previous', () => {
        this.sink({ type: 'previous' });
      });
      player.on('raise', () => {
        this.raise();
      });
      player.on('seek', (offset: unknown) => {
        if (typeof offset !== 'number' || !this.state) {
          return;
        }
        const target = Math.max(0, this.state.currentTimeSec + offset / 1e6);
        this.sink({ type: 'seekTo', seconds: target });
      });
      player.on('position', (event: unknown) => {
        if (typeof event !== 'object' || event === null) {
          return;
        }
        const position = (event as { position?: unknown }).position;
        if (typeof position !== 'number') {
          return;
        }
        this.sink({ type: 'seekTo', seconds: Math.max(0, position / 1e6) });
      });
      player.on('volume', (volume: unknown) => {
        if (typeof volume !== 'number' || !Number.isFinite(volume)) {
          return;
        }
        this.sink({ type: 'setVolume', volume: Math.min(1, Math.max(0, volume)) });
      });
      player.on('shuffle', () => {
        this.sink({ type: 'toggleShuffle' });
      });
      player.on('loopStatus', () => {
        this.sink({ type: 'cycleRepeat' });
      });
      this.fallback = player;
      this.syncFallback();
    } catch (error) {
      logWarn('mpris', 'Could not start mpris-service fallback', error);
      this.fallback = null;
    }
  }

  private stopFallback(): void {
    const player = this.fallback;
    if (!player) {
      return;
    }
    this.fallback = null;
    try {
      player.removeAllListeners();
      const bus = (player as unknown as PrivateBus)._bus;
      if (bus) {
        bus.disconnect();
      }
    } catch (error) {
      logWarn('mpris', 'Failed to stop fallback', error);
    }
  }

  private syncFallback(): void {
    const player = this.fallback;
    const state = this.state;
    if (!player || !state) {
      return;
    }
    try {
      if (state.hasTrack && !state.isAd) {
        const trackId = state.videoId !== '' ? state.videoId.replace(/[^A-Za-z0-9_]/g, '_') : 'current';
        player.metadata = {
          'mpris:trackid': player.objectPath(`track/${trackId}`),
          'mpris:length': Math.round(state.durationSec * 1e6),
          'mpris:artUrl': state.artworkUrl,
          'xesam:title': state.title,
          'xesam:album': state.album,
          'xesam:artist': [state.artist],
        };
      }
      const status = state.hasTrack ? (state.isPlaying ? 'Playing' : 'Paused') : 'Stopped';
      if (player.playbackStatus !== status) {
        player.playbackStatus = status;
      }
      if (Math.abs(player.volume - state.volume) > 0.001) {
        player.volume = state.volume;
      }
      if (player.shuffle !== state.shuffle) {
        player.shuffle = state.shuffle;
      }
      const loop = loopStatusFor(state.repeatMode);
      if (player.loopStatus !== loop) {
        player.loopStatus = loop;
      }
    } catch (error) {
      logWarn('mpris', 'Failed to sync fallback state', error);
    }
  }

  notifySeeked(seconds: number): void {
    const player = this.fallback;
    if (!player) {
      return;
    }
    try {
      player.seeked(Math.round(seconds * 1e6));
    } catch (error) {
      logWarn('mpris', 'Seeked signal failed', error);
    }
  }

  isFallbackActive(): boolean {
    return this.fallback !== null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.stopFallback();
    if (this.bus) {
      try {
        this.bus.disconnect();
      } catch (error) {
        logWarn('mpris', 'Bus disconnect failed', error);
      }
      this.bus = null;
    }
  }
}
