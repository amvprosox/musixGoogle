import type { ShellApi } from '../shared/channels';
import { OPTIMISTIC_TIMEOUT_MS, SEEK_STEP_SEC, VOLUME_STEP } from '../shared/constants';
import { clampVolume, seekBy, stepVolume } from '../shared/player-math';
import type { DownloadItem, PlayerCommand, PlayerState, RepeatMode } from '../shared/types';
import { displayedPlaying, type Store } from './state';

export class PlayerActions {
  private optimisticTimer: number | null = null;
  private offlineAudio: HTMLAudioElement | null = null;
  private offlineVideoId: string | null = null;

  constructor(
    private readonly store: Store,
    private readonly api: ShellApi,
  ) {}

  isOfflineActive(): boolean {
    return this.offlineVideoId !== null && this.offlineAudio !== null;
  }

  stopOffline(): void {
    if (this.offlineAudio) {
      this.offlineAudio.pause();
      this.offlineAudio.removeAttribute('src');
      this.offlineAudio.load();
    }
    this.offlineVideoId = null;
  }

  playDownloaded(item: DownloadItem): void {
    if (item.status !== 'completed' || item.audioUrl === '') {
      return;
    }
    this.api.send('view:command', { type: 'pause' });
    const audio = this.ensureOfflineAudio();
    this.offlineVideoId = item.videoId;
    audio.src = item.audioUrl;
    const prev = this.store.getState().player;
    audio.volume = prev ? clampVolume(prev.volume) : 1;
    audio.muted = prev ? prev.isMuted : false;
    const nextState: PlayerState = {
      hasTrack: true,
      title: item.title,
      artist: item.artist,
      album: item.album,
      artworkUrl: item.artworkUrl,
      durationSec: item.durationSec,
      currentTimeSec: 0,
      isPlaying: true,
      volume: audio.volume,
      isMuted: audio.muted,
      likeStatus: 'INDIFFERENT',
      shuffle: prev ? prev.shuffle : false,
      repeatMode: prev ? prev.repeatMode : 'NONE',
      videoId: item.videoId,
      isAd: false,
    };
    this.store.dispatch({ type: 'optimistic-playing', value: null });
    this.store.dispatch({ type: 'player', player: nextState });
    audio.play().catch(() => {
      this.syncOfflineState(false);
    });
  }

  private ensureOfflineAudio(): HTMLAudioElement {
    if (this.offlineAudio) {
      return this.offlineAudio;
    }
    const audio = document.createElement('audio');
    audio.preload = 'none';
    audio.addEventListener('timeupdate', () => {
      if (this.offlineVideoId !== null) {
        this.syncOfflineState(!audio.paused);
      }
    });
    audio.addEventListener('loadedmetadata', () => {
      if (this.offlineVideoId !== null) {
        this.syncOfflineState(!audio.paused);
      }
    });
    audio.addEventListener('play', () => {
      if (this.offlineVideoId !== null) {
        this.syncOfflineState(true);
      }
    });
    audio.addEventListener('pause', () => {
      if (this.offlineVideoId !== null) {
        this.syncOfflineState(false);
      }
    });
    audio.addEventListener('ended', () => {
      if (this.offlineVideoId === null) {
        return;
      }
      const current = this.store.getState().player;
      if (current && current.repeatMode === 'ONE') {
        audio.currentTime = 0;
        audio.play().catch(() => {
          this.syncOfflineState(false);
        });
        return;
      }
      if (!this.stepOfflineTrack(1, current ? current.repeatMode === 'ALL' : false)) {
        this.syncOfflineState(false);
      }
    });
    this.offlineAudio = audio;
    return audio;
  }

  private syncOfflineState(isPlaying: boolean): void {
    const current = this.store.getState().player;
    const audio = this.offlineAudio;
    if (!current || !audio || this.offlineVideoId === null) {
      return;
    }
    const duration =
      Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current.durationSec;
    const currentTime = Number.isFinite(audio.currentTime) && audio.currentTime >= 0 ? audio.currentTime : 0;
    this.store.dispatch({
      type: 'player',
      player: {
        ...current,
        durationSec: duration,
        currentTimeSec: Math.min(currentTime, duration > 0 ? duration : currentTime),
        isPlaying,
        volume: audio.volume,
        isMuted: audio.muted,
      },
    });
  }

  private stepOfflineTrack(direction: 1 | -1, wrap: boolean): boolean {
    const completed = this.store
      .getState()
      .downloads.filter((item) => item.status === 'completed' && item.audioUrl !== '');
    if (completed.length === 0) {
      return false;
    }
    const idx = completed.findIndex((item) => item.videoId === this.offlineVideoId);
    if (idx === -1) {
      return false;
    }
    const nextIdx = idx + direction;
    if (nextIdx >= 0 && nextIdx < completed.length) {
      const target = completed[nextIdx];
      if (target) {
        this.playDownloaded(target);
        return true;
      }
    }
    if (wrap && completed.length > 0) {
      const wrapped = completed[direction > 0 ? 0 : completed.length - 1];
      if (wrapped) {
        this.playDownloaded(wrapped);
        return true;
      }
    }
    return false;
  }

  command(command: PlayerCommand): void {
    if (command.type === 'playVideo' || command.type === 'playQueueIndex') {
      this.stopOffline();
    }
    this.api.send('view:command', command);
  }

  hasTrack(): boolean {
    const player = this.store.getState().player;
    return player !== null && player.hasTrack;
  }

  togglePlay(): void {
    if (!this.hasTrack()) {
      return;
    }
    if (this.isOfflineActive() && this.offlineAudio) {
      if (this.offlineAudio.paused) {
        this.offlineAudio.play().catch(() => {
          this.syncOfflineState(false);
        });
      } else {
        this.offlineAudio.pause();
      }
      return;
    }
    const target = !displayedPlaying(this.store.getState());
    this.store.dispatch({ type: 'optimistic-playing', value: target });
    if (this.optimisticTimer !== null) {
      window.clearTimeout(this.optimisticTimer);
    }
    this.optimisticTimer = window.setTimeout(() => {
      this.optimisticTimer = null;
      if (this.store.getState().optimisticPlaying === target) {
        this.store.dispatch({ type: 'optimistic-playing', value: null });
      }
    }, OPTIMISTIC_TIMEOUT_MS);
    this.command({ type: 'togglePlay' });
  }

  next(): void {
    if (this.isOfflineActive()) {
      this.stepOfflineTrack(1, true);
      return;
    }
    this.command({ type: 'next' });
  }

  previous(): void {
    if (this.isOfflineActive()) {
      if (this.offlineAudio && this.offlineAudio.currentTime > 3) {
        this.offlineAudio.currentTime = 0;
        this.syncOfflineState(!this.offlineAudio.paused);
        return;
      }
      this.stepOfflineTrack(-1, true);
      return;
    }
    this.command({ type: 'previous' });
  }

  seekTo(seconds: number): void {
    const player = this.store.getState().player;
    if (!player || !player.hasTrack || player.isAd) {
      return;
    }
    const target = Math.max(0, Math.min(seconds, player.durationSec > 0 ? player.durationSec : seconds));
    if (this.isOfflineActive() && this.offlineAudio) {
      this.offlineAudio.currentTime = target;
      this.syncOfflineState(!this.offlineAudio.paused);
      return;
    }
    this.command({ type: 'seekTo', seconds: target });
  }

  seekRelative(direction: 1 | -1): void {
    const player = this.store.getState().player;
    if (!player || !player.hasTrack || player.isAd) {
      return;
    }
    this.seekTo(seekBy(player.currentTimeSec, direction * SEEK_STEP_SEC, player.durationSec));
  }

  setVolume(volume: number): void {
    const clamped = clampVolume(volume);
    if (this.isOfflineActive() && this.offlineAudio) {
      this.offlineAudio.volume = clamped;
      if (clamped > 0 && this.offlineAudio.muted) {
        this.offlineAudio.muted = false;
      }
      this.syncOfflineState(!this.offlineAudio.paused);
    }
    this.command({ type: 'setVolume', volume: clamped });
  }

  stepVolume(direction: 1 | -1): void {
    const player = this.store.getState().player;
    const current = player ? player.volume : 1;
    this.setVolume(stepVolume(current, direction * VOLUME_STEP));
  }

  toggleMute(): void {
    if (this.isOfflineActive() && this.offlineAudio) {
      this.offlineAudio.muted = !this.offlineAudio.muted;
      this.syncOfflineState(!this.offlineAudio.paused);
      return;
    }
    this.command({ type: 'toggleMute' });
  }

  toggleLike(): void {
    if (this.isOfflineActive()) {
      return;
    }
    this.command({ type: 'toggleLike' });
  }

  toggleDislike(): void {
    if (this.isOfflineActive()) {
      return;
    }
    this.command({ type: 'toggleDislike' });
  }

  toggleShuffle(): void {
    if (this.isOfflineActive()) {
      const current = this.store.getState().player;
      if (current) {
        this.store.dispatch({
          type: 'player',
          player: { ...current, shuffle: !current.shuffle },
        });
      }
      return;
    }
    this.command({ type: 'toggleShuffle' });
  }

  cycleRepeat(): void {
    if (this.isOfflineActive()) {
      const current = this.store.getState().player;
      if (current) {
        const nextMode: RepeatMode =
          current.repeatMode === 'NONE' ? 'ALL' : current.repeatMode === 'ALL' ? 'ONE' : 'NONE';
        this.store.dispatch({
          type: 'player',
          player: { ...current, repeatMode: nextMode },
        });
      }
      return;
    }
    this.command({ type: 'cycleRepeat' });
  }

  playQueueIndex(index: number): void {
    this.stopOffline();
    this.command({ type: 'playQueueIndex', index });
  }
}
