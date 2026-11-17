import type {
  AccountState,
  DesktopViewCommand,
  DesktopViewEvent,
  DetectedLibrary,
  DownloadBatchRequest,
  DownloadBatchResult,
  DownloadItem,
  DownloadTrackRequest,
  SavedLibrary,
  VoiceCommandEvent,
  VoiceConfigPatch,
  VoiceConfigView,
  VoicePlayRequest,
  VoiceStatus,
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
  LyricsResponse,
  PlayerState,
  QueueItem,
  ShellDialog,
  ShellMenuRequest,
  ShellNotice,
  SuggestResponse,
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
  'lyrics:get': { request: string | null; response: LyricsResponse };
  'search:suggest': { request: string; response: SuggestResponse };
  'downloads:list': { request: null; response: DownloadItem[] };
  'downloads:start': { request: DownloadTrackRequest; response: DownloadItem };
  'downloads:batch': { request: DownloadBatchRequest; response: DownloadBatchResult };
  'downloads:delete': { request: string; response: boolean };
  'downloads:logs': { request: null; response: string[] };
  'downloads:logs-clear': { request: null; response: boolean };
  'downloads:libraries': { request: null; response: DetectedLibrary[] };
  'downloads:saved-libraries': { request: null; response: SavedLibrary[] };
  'downloads:get-lyrics': { request: null; response: { saved: number; missing: number } };
  'voice:get': { request: null; response: { config: VoiceConfigView; status: VoiceStatus } };
  'voice:set': { request: VoiceConfigPatch; response: VoiceConfigView };
  'voice:set-ai-key': { request: string | null; response: VoiceConfigView };
  'voice:connect-ai': { request: null; response: VoiceConfigView };
  'voice:download-pack': { request: null; response: boolean };
  'voice:enroll': { request: Float32Array[]; response: { ok: boolean; threshold: number; message: string } };
  'voice:test': { request: Float32Array; response: number | null };
  'voice:forget': { request: null; response: VoiceConfigView };
  'voice:play-search': { request: VoicePlayRequest; response: string | null };
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
  'offline:active': boolean;
  'voice:audio': Float32Array;
  /** Uncancelled mic audio, used only to catch the wake word over loud music. */
  'voice:audio-raw': Float32Array;
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
  'downloads:changed': DownloadItem[];
  'downloads:logs-changed': string[];
  'player:remote': PlayerCommand;
  'downloads:saved-libraries-changed': SavedLibrary[];
  'voice:status': VoiceStatus;
  'voice:command': VoiceCommandEvent;
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
  'downloads:changed',
  'downloads:logs-changed',
  'player:remote',
  'downloads:saved-libraries-changed',
  'voice:status',
  'voice:command',
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
