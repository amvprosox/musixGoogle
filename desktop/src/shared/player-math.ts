import type { RepeatMode } from './types';

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function clampVolume(volume: number): number {
  return Math.round(clamp(volume, 0, 1) * 100) / 100;
}

export function stepVolume(volume: number, delta: number): number {
  return clampVolume(volume + delta);
}

export function seekBy(currentSec: number, deltaSec: number, durationSec: number): number {
  const max =
    Number.isFinite(durationSec) && durationSec > 0 ? durationSec : Math.max(0, currentSec + deltaSec);
  return clamp(currentSec + deltaSec, 0, max);
}

export function ratioFromPointer(clientX: number, left: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return 0;
  }
  return clamp((clientX - left) / width, 0, 1);
}

export function timeFromRatio(ratio: number, durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return 0;
  }
  return clamp(ratio, 0, 1) * durationSec;
}

export function progressRatio(currentSec: number, durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return 0;
  }
  return clamp(currentSec / durationSec, 0, 1);
}

export type VolumeIconName = 'volume-x' | 'volume' | 'volume-1' | 'volume-2';

export function volumeIconName(volume: number, muted: boolean): VolumeIconName {
  if (muted || volume <= 0) {
    return 'volume-x';
  }
  if (volume < 0.34) {
    return 'volume';
  }
  if (volume < 0.67) {
    return 'volume-1';
  }
  return 'volume-2';
}

export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  if (mode === 'NONE') {
    return 'ALL';
  }
  if (mode === 'ALL') {
    return 'ONE';
  }
  return 'NONE';
}

export function keyboardSliderValue(
  key: string,
  value: number,
  min: number,
  max: number,
  step: number,
  bigStep: number,
): number | null {
  if (key === 'ArrowRight' || key === 'ArrowUp') {
    return clamp(value + step, min, max);
  }
  if (key === 'ArrowLeft' || key === 'ArrowDown') {
    return clamp(value - step, min, max);
  }
  if (key === 'PageUp') {
    return clamp(value + bigStep, min, max);
  }
  if (key === 'PageDown') {
    return clamp(value - bigStep, min, max);
  }
  if (key === 'Home') {
    return min;
  }
  if (key === 'End') {
    return max;
  }
  return null;
}
