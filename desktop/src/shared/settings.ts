import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
} from './constants';
import { isBoolean, isFiniteNumber, isRecord } from './guards';
import type { AppSettings, ThemePreference, WindowState } from './types';

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  theme: 'system',
  closeToTray: true,
  startOnLogin: false,
  notifyOnTrackChange: true,
  adblockEnabled: true,
  adSkipFallback: true,
  queueOpenOnWideScreens: true,
};

export const SETTINGS_KEYS: readonly (keyof AppSettings)[] = [
  'theme',
  'closeToTray',
  'startOnLogin',
  'notifyOnTrackChange',
  'adblockEnabled',
  'adSkipFallback',
  'queueOpenOnWideScreens',
];

export const DEFAULT_WINDOW_STATE: Readonly<WindowState> = {
  x: null,
  y: null,
  width: DEFAULT_WINDOW_WIDTH,
  height: DEFAULT_WINDOW_HEIGHT,
  isMaximized: false,
  sidebarCollapsed: false,
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isValidSettingValue(key: keyof AppSettings, value: unknown): boolean {
  if (key === 'theme') {
    return isThemePreference(value);
  }
  return isBoolean(value);
}

export function normalizeSettings(input: unknown): AppSettings {
  const result: AppSettings = { ...DEFAULT_SETTINGS };
  if (!isRecord(input)) {
    return result;
  }
  const theme = input.theme;
  if (isThemePreference(theme)) {
    result.theme = theme;
  }
  for (const key of SETTINGS_KEYS) {
    if (key === 'theme') {
      continue;
    }
    const value = input[key];
    if (isBoolean(value)) {
      result[key] = value;
    }
  }
  return result;
}

export function isSettingsPatch(input: unknown): input is Partial<AppSettings> {
  if (!isRecord(input)) {
    return false;
  }
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return false;
  }
  return keys.every((key) => {
    if (!(SETTINGS_KEYS as readonly string[]).includes(key)) {
      return false;
    }
    return isValidSettingValue(key as keyof AppSettings, input[key]);
  });
}

export interface SettingsPatchResult {
  settings: AppSettings;
  changed: (keyof AppSettings)[];
}

export function applySettingsPatch(current: AppSettings, patch: unknown): SettingsPatchResult {
  if (!isSettingsPatch(patch)) {
    return { settings: current, changed: [] };
  }
  const next = normalizeSettings({ ...current, ...patch });
  const changed = SETTINGS_KEYS.filter((key) => next[key] !== current[key]);
  return { settings: next, changed };
}

export function normalizeWindowState(input: unknown): WindowState {
  const result: WindowState = { ...DEFAULT_WINDOW_STATE };
  if (!isRecord(input)) {
    return result;
  }
  if (isFiniteNumber(input.width) && input.width >= MIN_WINDOW_WIDTH) {
    result.width = Math.round(input.width);
  }
  if (isFiniteNumber(input.height) && input.height >= MIN_WINDOW_HEIGHT) {
    result.height = Math.round(input.height);
  }
  if (isFiniteNumber(input.x) && isFiniteNumber(input.y)) {
    result.x = Math.round(input.x);
    result.y = Math.round(input.y);
  }
  if (isBoolean(input.isMaximized)) {
    result.isMaximized = input.isMaximized;
  }
  if (isBoolean(input.sidebarCollapsed)) {
    result.sidebarCollapsed = input.sidebarCollapsed;
  }
  return result;
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  if (preference === 'system') {
    return systemDark ? 'dark' : 'light';
  }
  return preference;
}
