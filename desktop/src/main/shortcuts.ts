import { globalShortcut, type WebContents } from 'electron';
import type { PlayerCommand } from '../shared/types';
import { logInfo, logWarn } from './log';
import { isBlockedBrowserShortcut } from '../shared/native';

const MEDIA_KEYS: readonly { accelerator: string; command: PlayerCommand }[] = [
  { accelerator: 'MediaPlayPause', command: { type: 'togglePlay' } },
  { accelerator: 'MediaNextTrack', command: { type: 'next' } },
  { accelerator: 'MediaPreviousTrack', command: { type: 'previous' } },
  { accelerator: 'MediaStop', command: { type: 'pause' } },
];

export function isX11Session(env: NodeJS.ProcessEnv = process.env): boolean {
  const type = env.XDG_SESSION_TYPE;
  if (type === 'x11') {
    return true;
  }
  if (type === 'wayland') {
    return false;
  }
  return typeof env.DISPLAY === 'string' && env.DISPLAY !== '' && !env.WAYLAND_DISPLAY;
}

export function registerMediaKeys(sink: (command: PlayerCommand) => void): void {
  if (!isX11Session()) {
    logInfo('shortcuts', 'Wayland session: media keys are routed through MPRIS');
    return;
  }
  for (const { accelerator, command } of MEDIA_KEYS) {
    try {
      const ok = globalShortcut.register(accelerator, () => {
        sink(command);
      });
      if (!ok) {
        logInfo('shortcuts', `${accelerator} is owned by the desktop, MPRIS will handle it`);
      }
    } catch (error) {
      logWarn('shortcuts', `Could not register ${accelerator}`, error);
    }
  }
}

export function unregisterMediaKeys(): void {
  globalShortcut.unregisterAll();
}

export function installQuitAccelerator(contents: WebContents, quit: () => void): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return;
    }
    const key = input.key.toLowerCase();
    if (input.control && !input.alt && !input.meta && !input.shift && key === 'q') {
      event.preventDefault();
      quit();
    }
  });
}

export function hardenContents(contents: WebContents, devMode: boolean): void {
  const limitZoom = (): void => {
    if (contents.isDestroyed()) {
      return;
    }
    contents.setZoomFactor(1);
    contents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
  };
  contents.on('did-finish-load', limitZoom);
  contents.on('zoom-changed', limitZoom);
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') {
      return;
    }
    if (isBlockedBrowserShortcut(input, devMode)) {
      event.preventDefault();
    }
  });
  if (!devMode) {
    contents.on('devtools-opened', () => {
      contents.closeDevTools();
    });
  }
}
