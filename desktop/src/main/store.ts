import Store from 'electron-store';
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  DEFAULT_WINDOW_STATE,
  normalizeSettings,
  normalizeWindowState,
} from '../shared/settings';
import type { AppSettings, WindowState } from '../shared/types';
import { logError } from './log';

interface StoreShape {
  settings: AppSettings;
  windowState: WindowState;
  lastUrl: string;
}

type SettingsListener = (settings: AppSettings, changed: (keyof AppSettings)[]) => void;

export class AppStore {
  private readonly store: Store<StoreShape>;
  private settings: AppSettings;
  private windowState: WindowState;
  private readonly listeners = new Set<SettingsListener>();

  constructor() {
    this.store = new Store<StoreShape>({
      name: 'config',
      defaults: {
        settings: { ...DEFAULT_SETTINGS },
        windowState: { ...DEFAULT_WINDOW_STATE },
        lastUrl: '',
      },
      clearInvalidConfig: true,
    });
    this.settings = normalizeSettings(this.safeGet('settings'));
    this.windowState = normalizeWindowState(this.safeGet('windowState'));
  }

  private safeGet(key: keyof StoreShape): unknown {
    try {
      return this.store.get(key);
    } catch (error) {
      logError('store', `Failed to read ${key}`, error);
      return undefined;
    }
  }

  private safeSet<K extends keyof StoreShape>(key: K, value: StoreShape[K]): void {
    try {
      const patch: Partial<StoreShape> = {};
      patch[key] = value;
      this.store.set(patch);
    } catch (error) {
      logError('store', `Failed to write ${key}`, error);
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSettings(patch: unknown): { settings: AppSettings; changed: (keyof AppSettings)[] } {
    const result = applySettingsPatch(this.settings, patch);
    if (result.changed.length === 0) {
      return result;
    }
    this.settings = result.settings;
    this.safeSet('settings', this.settings);
    this.emit(result.changed);
    return { settings: this.getSettings(), changed: result.changed };
  }

  resetSettings(): AppSettings {
    const previous = this.settings;
    this.settings = { ...DEFAULT_SETTINGS };
    this.safeSet('settings', this.settings);
    const changed = (Object.keys(this.settings) as (keyof AppSettings)[]).filter(
      (key) => previous[key] !== this.settings[key],
    );
    if (changed.length > 0) {
      this.emit(changed);
    }
    return this.getSettings();
  }

  onSettingsChanged(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(changed: (keyof AppSettings)[]): void {
    const snapshot = this.getSettings();
    for (const listener of this.listeners) {
      try {
        listener(snapshot, changed);
      } catch (error) {
        logError('store', 'Settings listener failed', error);
      }
    }
  }

  getWindowState(): WindowState {
    return { ...this.windowState };
  }

  saveWindowState(patch: Partial<WindowState>): void {
    this.windowState = normalizeWindowState({ ...this.windowState, ...patch });
    this.safeSet('windowState', this.windowState);
  }

  getLastUrl(): string {
    const value = this.safeGet('lastUrl');
    return typeof value === 'string' ? value : '';
  }

  setLastUrl(url: string): void {
    this.safeSet('lastUrl', url);
  }
}
