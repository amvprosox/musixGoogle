import type { ShellApi } from '../shared/channels';
import { OPTIMISTIC_TIMEOUT_MS, SEEK_STEP_SEC, VOLUME_STEP } from '../shared/constants';
import { clampVolume, seekBy, stepVolume } from '../shared/player-math';
import type { PlayerCommand } from '../shared/types';
import { displayedPlaying, type Store } from './state';

export class PlayerActions {
  private optimisticTimer: number | null = null;

  constructor(
    private readonly store: Store,
    private readonly api: ShellApi,
  ) {}

  command(command: PlayerCommand): void {
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
    this.command({ type: 'next' });
  }

  previous(): void {
    this.command({ type: 'previous' });
  }

  seekTo(seconds: number): void {
    const player = this.store.getState().player;
    if (!player || !player.hasTrack || player.isAd) {
      return;
    }
    const target = Math.max(0, Math.min(seconds, player.durationSec > 0 ? player.durationSec : seconds));
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
    this.command({ type: 'setVolume', volume: clampVolume(volume) });
  }

  stepVolume(direction: 1 | -1): void {
    const player = this.store.getState().player;
    const current = player ? player.volume : 1;
    this.setVolume(stepVolume(current, direction * VOLUME_STEP));
  }

  toggleMute(): void {
    this.command({ type: 'toggleMute' });
  }

  toggleLike(): void {
    this.command({ type: 'toggleLike' });
  }

  toggleDislike(): void {
    this.command({ type: 'toggleDislike' });
  }

  toggleShuffle(): void {
    this.command({ type: 'toggleShuffle' });
  }

  cycleRepeat(): void {
    this.command({ type: 'cycleRepeat' });
  }

  playQueueIndex(index: number): void {
    this.command({ type: 'playQueueIndex', index });
  }
}
