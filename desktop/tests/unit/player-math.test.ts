import { describe, expect, it } from 'vitest';
import {
  clamp,
  clampVolume,
  keyboardSliderValue,
  nextRepeatMode,
  progressRatio,
  ratioFromPointer,
  seekBy,
  stepVolume,
  timeFromRatio,
  volumeIconName,
} from '../../src/shared/player-math';

describe('volume math', () => {
  it('clamps and rounds volume', () => {
    expect(clampVolume(1.4)).toBe(1);
    expect(clampVolume(-0.2)).toBe(0);
    expect(clampVolume(0.333333)).toBe(0.33);
  });

  it('steps volume by 5 percent', () => {
    expect(stepVolume(0.5, 0.05)).toBe(0.55);
    expect(stepVolume(0.98, 0.05)).toBe(1);
    expect(stepVolume(0.02, -0.05)).toBe(0);
  });

  it('chooses the right icon', () => {
    expect(volumeIconName(0.8, true)).toBe('volume-x');
    expect(volumeIconName(0, false)).toBe('volume-x');
    expect(volumeIconName(0.2, false)).toBe('volume');
    expect(volumeIconName(0.5, false)).toBe('volume-1');
    expect(volumeIconName(0.9, false)).toBe('volume-2');
  });
});

describe('seek math', () => {
  it('seeks within bounds', () => {
    expect(seekBy(30, 10, 200)).toBe(40);
    expect(seekBy(5, -10, 200)).toBe(0);
    expect(seekBy(195, 10, 200)).toBe(200);
  });

  it('handles unknown duration', () => {
    expect(seekBy(30, 10, 0)).toBe(40);
    expect(seekBy(30, -40, Number.NaN)).toBe(0);
  });

  it('maps pointer positions to ratios and times', () => {
    expect(ratioFromPointer(150, 100, 200)).toBe(0.25);
    expect(ratioFromPointer(50, 100, 200)).toBe(0);
    expect(ratioFromPointer(400, 100, 200)).toBe(1);
    expect(ratioFromPointer(150, 100, 0)).toBe(0);
    expect(timeFromRatio(0.5, 200)).toBe(100);
    expect(timeFromRatio(0.5, 0)).toBe(0);
    expect(progressRatio(50, 200)).toBe(0.25);
    expect(progressRatio(50, 0)).toBe(0);
  });

  it('clamps generic values', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(Number.NaN, 1, 3)).toBe(1);
  });
});

describe('keyboard slider', () => {
  it('maps keys to values', () => {
    expect(keyboardSliderValue('ArrowRight', 10, 0, 100, 5, 20)).toBe(15);
    expect(keyboardSliderValue('ArrowDown', 10, 0, 100, 5, 20)).toBe(5);
    expect(keyboardSliderValue('PageUp', 90, 0, 100, 5, 20)).toBe(100);
    expect(keyboardSliderValue('Home', 50, 0, 100, 5, 20)).toBe(0);
    expect(keyboardSliderValue('End', 50, 0, 100, 5, 20)).toBe(100);
    expect(keyboardSliderValue('a', 50, 0, 100, 5, 20)).toBeNull();
  });
});

describe('repeat cycle', () => {
  it('cycles NONE, ALL, ONE', () => {
    expect(nextRepeatMode('NONE')).toBe('ALL');
    expect(nextRepeatMode('ALL')).toBe('ONE');
    expect(nextRepeatMode('ONE')).toBe('NONE');
  });
});
