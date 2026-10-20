import type { PlayerState } from './types';

export interface TrayMenuModel {
  trackLabel: string;
  playLabel: 'Play' | 'Pause';
  windowLabel: 'Show window' | 'Hide window';
  canControl: boolean;
}

export function trayMenuModel(state: PlayerState | null, windowVisible: boolean): TrayMenuModel {
  const hasTrack = state !== null && state.hasTrack;
  let trackLabel = 'Nothing playing';
  if (state && hasTrack) {
    trackLabel = state.isAd
      ? 'Advertisement'
      : [state.title, state.artist].filter((v) => v !== '').join(' - ');
  }
  if (trackLabel.length > 64) {
    trackLabel = `${trackLabel.slice(0, 61)}...`;
  }
  return {
    trackLabel,
    playLabel: state?.isPlaying ? 'Pause' : 'Play',
    windowLabel: windowVisible ? 'Hide window' : 'Show window',
    canControl: hasTrack,
  };
}
