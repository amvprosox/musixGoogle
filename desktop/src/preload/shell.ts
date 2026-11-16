import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  BOOT_ARG_PREFIX,
  SHELL_EVENT_CHANNELS,
  type ShellApi,
  type ShellEventChannel,
  type ShellEventChannels,
  type ShellInvokeChannel,
  type ShellInvokeChannels,
  type ShellSendChannel,
  type ShellSendChannels,
} from '../shared/channels';
import { isRecord } from '../shared/guards';
import { isResolvedTheme, isThemePreference } from '../shared/settings';
import { desktopPlatform, type BootInfo } from '../shared/types';

const INVOKE_CHANNELS: Readonly<Record<ShellInvokeChannel, true>> = {
  'app:get-initial': true,
  'view:freeze': true,
  'settings:set': true,
  'settings:reset': true,
  'adblock:update-now': true,
  'data:clear-cache': true,
  'data:sign-out': true,
  'lyrics:get': true,
  'search:suggest': true,
  'downloads:list': true,
  'downloads:start': true,
  'downloads:batch': true,
  'downloads:delete': true,
  'downloads:logs': true,
  'downloads:logs-clear': true,
  'downloads:libraries': true,
  'downloads:saved-libraries': true,
  'downloads:get-lyrics': true,
  'voice:get': true,
  'voice:set': true,
  'voice:set-ai-key': true,
  'voice:download-pack': true,
  'voice:enroll': true,
  'voice:test': true,
  'voice:forget': true,
  'voice:play-search': true,
};

const SEND_CHANNELS: Readonly<Record<ShellSendChannel, true>> = {
  'view:layout': true,
  'view:command': true,
  'view:history': true,
  'view:reload': true,
  'window:sidebar-collapsed': true,
  'app:quit': true,
  'overlay:tooltip': true,
  'overlay:toasts': true,
  'window:control': true,
  'menu:open': true,
  'offline:active': true,
  'voice:audio': true,
};

function parseBoot(argv: readonly string[]): BootInfo | null {
  const arg = argv.find((value) => value.startsWith(BOOT_ARG_PREFIX));
  if (!arg) {
    return null;
  }
  try {
    const decoded: unknown = JSON.parse(atob(arg.slice(BOOT_ARG_PREFIX.length)));
    if (!isRecord(decoded)) {
      return null;
    }
    const { theme, themePreference, sidebarCollapsed, platform } = decoded;
    if (!isResolvedTheme(theme) || !isThemePreference(themePreference)) {
      return null;
    }
    return {
      theme,
      themePreference,
      sidebarCollapsed: sidebarCollapsed === true,
      platform: typeof platform === 'string' ? desktopPlatform(platform) : 'other',
    };
  } catch {
    return null;
  }
}

const api: ShellApi = {
  boot: parseBoot(process.argv),
  invoke<C extends ShellInvokeChannel>(
    channel: C,
    payload: ShellInvokeChannels[C]['request'],
  ): Promise<ShellInvokeChannels[C]['response']> {
    if (!Object.hasOwn(INVOKE_CHANNELS, channel)) {
      return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload) as Promise<ShellInvokeChannels[C]['response']>;
  },
  send<C extends ShellSendChannel>(channel: C, payload: ShellSendChannels[C]): void {
    if (!Object.hasOwn(SEND_CHANNELS, channel)) {
      return;
    }
    ipcRenderer.send(channel, payload);
  },
  on<C extends ShellEventChannel>(
    channel: C,
    listener: (payload: ShellEventChannels[C]) => void,
  ): () => void {
    if (!SHELL_EVENT_CHANNELS.includes(channel)) {
      return () => undefined;
    }
    const wrapped = (_event: IpcRendererEvent, payload: ShellEventChannels[C]): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('musix', api);
