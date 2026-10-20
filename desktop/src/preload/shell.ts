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
import { isThemePreference } from '../shared/settings';
import { desktopPlatform, type BootInfo } from '../shared/types';

const INVOKE_CHANNELS: readonly ShellInvokeChannel[] = [
  'app:get-initial',
  'view:freeze',
  'settings:set',
  'settings:reset',
  'adblock:update-now',
  'data:clear-cache',
  'data:sign-out',
];

const SEND_CHANNELS: readonly ShellSendChannel[] = [
  'view:layout',
  'view:command',
  'view:history',
  'view:reload',
  'window:sidebar-collapsed',
  'app:quit',
  'overlay:tooltip',
  'overlay:toasts',
  'window:control',
  'menu:open',
];

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
    if ((theme !== 'light' && theme !== 'dark') || !isThemePreference(themePreference)) {
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
    if (!INVOKE_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload) as Promise<ShellInvokeChannels[C]['response']>;
  },
  send<C extends ShellSendChannel>(channel: C, payload: ShellSendChannels[C]): void {
    if (!SEND_CHANNELS.includes(channel)) {
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
