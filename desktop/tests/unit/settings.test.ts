import { describe, expect, it } from 'vitest';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  DEFAULT_WINDOW_STATE,
  isSettingsPatch,
  normalizeSettings,
  normalizeWindowState,
  resolveTheme,
} from '../../src/shared/settings';

describe('settings schema', () => {
  it('fills defaults for missing or invalid input', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: 'purple', closeToTray: 'yes' })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    const result = normalizeSettings({ theme: 'light', closeToTray: false, startOnLogin: true, extra: 1 });
    expect(result.theme).toBe('light');
    expect(result.closeToTray).toBe(false);
    expect(result.startOnLogin).toBe(true);
    expect(Object.keys(result)).not.toContain('extra');
  });

  it('validates patches strictly', () => {
    expect(isSettingsPatch({ theme: 'dark' })).toBe(true);
    expect(isSettingsPatch({ adblockEnabled: false })).toBe(true);
    expect(isSettingsPatch({})).toBe(false);
    expect(isSettingsPatch({ theme: 'blue' })).toBe(false);
    expect(isSettingsPatch({ unknown: true })).toBe(false);
    expect(isSettingsPatch({ closeToTray: 1 })).toBe(false);
    expect(isSettingsPatch(null)).toBe(false);
    expect(isSettingsPatch([])).toBe(false);
  });

  it('applies patches and reports changed keys', () => {
    const result = applySettingsPatch(DEFAULT_SETTINGS, { theme: 'dark', closeToTray: true });
    expect(result.settings.theme).toBe('dark');
    expect(result.changed).toEqual(['theme']);
    const rejected = applySettingsPatch(DEFAULT_SETTINGS, { theme: 'neon' });
    expect(rejected.changed).toEqual([]);
    expect(rejected.settings).toBe(DEFAULT_SETTINGS);
  });

  it('resolves themes', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('window state schema', () => {
  it('rejects sizes below the minimum and keeps valid geometry', () => {
    expect(normalizeWindowState({ width: 100, height: 100 })).toEqual(DEFAULT_WINDOW_STATE);
    const state = normalizeWindowState({
      width: 1000.4,
      height: 700,
      x: 10,
      y: 20,
      isMaximized: true,
      sidebarCollapsed: true,
    });
    expect(state).toEqual({
      width: 1000,
      height: 700,
      x: 10,
      y: 20,
      isMaximized: true,
      sidebarCollapsed: true,
    });
  });

  it('requires both coordinates', () => {
    const state = normalizeWindowState({ x: 10 });
    expect(state.x).toBeNull();
    expect(state.y).toBeNull();
  });
});
