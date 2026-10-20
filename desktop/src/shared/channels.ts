import type {
  AccountState,
  DesktopViewCommand,
  DesktopViewEvent,
  AdblockStatus,
  AppCommand,
  AppSettings,
  BootInfo,
  HistoryDirection,
  InitialData,
  KeyPayload,
  OverlayRenderPayload,
  OverlaySize,
  PlayerCommand,
  PlayerState,
  QueueItem,
  ShellDialog,
  ShellMenuRequest,
  ShellNotice,
  WindowChromeState,
  WindowControl,
  ToastLayerRequest,
  TooltipRequest,
  ViewLayout,
  ViewNavState,
  ViewStatus,
} from './types';

export interface ShellInvokeChannels {
  'app:get-initial': { request: null; response: InitialData };
  'view:freeze': { request: null; response: string | null };
  'settings:set': { request: Partial<AppSettings>; response: AppSettings };
  'settings:reset': { request: null; response: AppSettings };
  'adblock:update-now': { request: null; response: AdblockStatus };
  'data:clear-cache': { request: null; response: boolean };
  'data:sign-out': { request: null; response: boolean };
}

export interface ShellSendChannels {
  'view:layout': ViewLayout;
  'view:command': PlayerCommand;
  'view:history': HistoryDirection;
  'view:reload': null;
  'window:sidebar-collapsed': boolean;
  'app:quit': null;
  'overlay:tooltip': TooltipRequest | null;
  'overlay:toasts': ToastLayerRequest;
  'window:control': WindowControl;
  'menu:open': ShellMenuRequest;
}

export interface ShellEventChannels {
  'player:state': PlayerState;
  'player:queue': QueueItem[];
  'view:status': ViewStatus;
  'view:nav': ViewNavState;
  'account:state': AccountState;
  'settings:changed': AppSettings;
  'adblock:status': AdblockStatus;
  'shortcut:key': KeyPayload;
  'theme:system': boolean;
  'toast:dismiss': string;
  'app:command': AppCommand;
  'window:chrome': WindowChromeState;
  'view:progress': 'start' | 'done';
  notice: ShellNotice;
  'dialog:show': ShellDialog;
}

export interface YtmSendChannels {
  'ytm:message': string;
  'ytm:desktop': DesktopViewEvent;
  'ytm:key': KeyPayload;
}

export interface YtmEventChannels {
  'ytm:command': string;
  'ytm:desktop-command': DesktopViewCommand;
}

export interface OverlaySendChannels {
  'overlay:size': OverlaySize;
  'overlay:toast-dismiss': string;
  'overlay:menu-select': string;
  'overlay:menu-close': null;
}

export interface OverlayEventChannels {
  'overlay:render': OverlayRenderPayload;
}

export const BOOT_ARG_PREFIX = '--musix-boot=';

export type ShellInvokeChannel = keyof ShellInvokeChannels;
export type ShellSendChannel = keyof ShellSendChannels;
export type ShellEventChannel = keyof ShellEventChannels;

export const SHELL_EVENT_CHANNELS: readonly ShellEventChannel[] = [
  'player:state',
  'player:queue',
  'view:status',
  'view:nav',
  'account:state',
  'settings:changed',
  'adblock:status',
  'shortcut:key',
  'theme:system',
  'toast:dismiss',
  'app:command',
  'window:chrome',
  'view:progress',
  'notice',
  'dialog:show',
];

export interface ShellApi {
  boot: BootInfo | null;
  invoke<C extends ShellInvokeChannel>(
    channel: C,
    payload: ShellInvokeChannels[C]['request'],
  ): Promise<ShellInvokeChannels[C]['response']>;
  send<C extends ShellSendChannel>(channel: C, payload: ShellSendChannels[C]): void;
  on<C extends ShellEventChannel>(channel: C, listener: (payload: ShellEventChannels[C]) => void): () => void;
}

export interface OverlayApi {
  onRender(listener: (payload: OverlayRenderPayload) => void): () => void;
  reportSize(size: OverlaySize): void;
  dismissToast(id: string): void;
  selectMenuItem(id: string): void;
  closeMenu(): void;
}
