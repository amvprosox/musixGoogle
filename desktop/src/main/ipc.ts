import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { pathToFileURL } from 'node:url';
import type { ShellEventChannel, ShellEventChannels } from '../shared/channels';
import { isBoolean } from '../shared/guards';
import { isSettingsPatch } from '../shared/settings';
import {
  isDesktopViewEvent,
  isHistoryDirection,
  isKeyPayload,
  isMenuAction,
  isOverlaySize,
  isPlayerCommand,
  isShellMenuRequest,
  isToastLayerRequest,
  isTooltipRequest,
  isViewLayout,
  isWindowControl,
} from '../shared/validators';
import { parseBridgeEvent } from '@musix/bridge/validate';
import type { BridgeEvent } from '@musix/bridge/contract';
import { isInViewAllowedUrl, isSameOrigin } from '../shared/routes';
import { isBoundedString } from '../shared/guards';
import type {
  AccountState,
  AppSettings,
  DesktopViewEvent,
  InitialData,
  LyricsResponse,
  ShellMenuRequest,
  SuggestResponse,
  WindowChromeState,
  WindowControl,
} from '../shared/types';
import type { AdblockManager } from './adblock';
import { paths } from './config';
import { logWarn } from './log';
import type { OverlayLayers } from './overlay';
import type { AppStore } from './store';
import type { YtmView } from './view';

export interface IpcContext {
  win: BrowserWindow;
  view: YtmView;
  overlays: OverlayLayers;
  store: AppStore;
  adblock: AdblockManager;
  base: string;
  version: string;
  systemDark: () => boolean;
  quit: () => void;
  onBridgeEvent: (event: BridgeEvent) => void;
  onDesktopEvent: (event: DesktopViewEvent) => void;
  onAccount: (account: AccountState) => void;
  account: () => AccountState;
  windowControl: (action: WindowControl) => void;
  openShellMenu: (request: ShellMenuRequest) => void;
  chrome: () => WindowChromeState;
  lyrics: () => Promise<LyricsResponse>;
  suggest: (query: string) => Promise<SuggestResponse>;
}

type AnyEvent = IpcMainEvent | IpcMainInvokeEvent;

function stripUrl(url: string): string {
  const hashless = url.split('#')[0] ?? '';
  return hashless.split('?')[0] ?? '';
}

export function registerIpc(ctx: IpcContext): () => void {
  const shellUrl = pathToFileURL(paths.shellHtml).href;
  const overlayUrl = pathToFileURL(paths.overlayHtml).href;

  const isMainFrame = (event: AnyEvent): boolean => {
    const frame = event.senderFrame;
    if (!frame) {
      return false;
    }
    const main = event.sender.mainFrame;
    return frame.processId === main.processId && frame.routingId === main.routingId;
  };

  const fromShell = (event: AnyEvent): boolean => {
    if (ctx.win.isDestroyed() || event.sender.isDestroyed()) {
      return false;
    }
    if (event.sender.id !== ctx.win.webContents.id || !isMainFrame(event)) {
      return false;
    }
    const frameUrl = event.senderFrame?.url ?? '';
    return stripUrl(frameUrl) === shellUrl;
  };

  const fromView = (event: AnyEvent): boolean => {
    if (!ctx.view.isFromView(event.sender) || !isMainFrame(event)) {
      return false;
    }
    const frameUrl = event.senderFrame?.url ?? '';
    return isSameOrigin(frameUrl, ctx.base);
  };

  const fromViewAnyAllowed = (event: AnyEvent): boolean => {
    if (!ctx.view.isFromView(event.sender) || !isMainFrame(event)) {
      return false;
    }
    return isInViewAllowedUrl(event.senderFrame?.url ?? '', ctx.base);
  };

  const fromOverlay = (event: AnyEvent): boolean => {
    if (!ctx.overlays.owns(event.sender) || !isMainFrame(event)) {
      return false;
    }
    const frameUrl = event.senderFrame?.url ?? '';
    return stripUrl(frameUrl) === overlayUrl;
  };

  const reject = (channel: string): void => {
    logWarn('ipc', `Rejected message on ${channel}`);
  };

  const handlers: [string, (event: IpcMainEvent, payload: unknown) => void][] = [
    [
      'view:layout',
      (event, payload) => {
        if (!fromShell(event) || !isViewLayout(payload)) {
          reject('view:layout');
          return;
        }
        ctx.view.setLayout(payload);
      },
    ],
    [
      'view:command',
      (event, payload) => {
        if (!fromShell(event) || !isPlayerCommand(payload)) {
          reject('view:command');
          return;
        }
        ctx.view.command(payload);
      },
    ],
    [
      'view:history',
      (event, payload) => {
        if (!fromShell(event) || !isHistoryDirection(payload)) {
          reject('view:history');
          return;
        }
        ctx.view.history(payload);
      },
    ],
    [
      'view:reload',
      (event) => {
        if (!fromShell(event)) {
          reject('view:reload');
          return;
        }
        ctx.view.reload();
      },
    ],
    [
      'window:sidebar-collapsed',
      (event, payload) => {
        if (!fromShell(event) || !isBoolean(payload)) {
          reject('window:sidebar-collapsed');
          return;
        }
        ctx.store.saveWindowState({ sidebarCollapsed: payload });
      },
    ],
    [
      'app:quit',
      (event) => {
        if (!fromShell(event)) {
          reject('app:quit');
          return;
        }
        ctx.quit();
      },
    ],
    [
      'overlay:tooltip',
      (event, payload) => {
        if (!fromShell(event)) {
          reject('overlay:tooltip');
          return;
        }
        if (payload === null || payload === undefined) {
          ctx.overlays.showTooltip(null);
          return;
        }
        if (!isTooltipRequest(payload)) {
          reject('overlay:tooltip');
          return;
        }
        ctx.overlays.showTooltip(payload);
      },
    ],
    [
      'overlay:toasts',
      (event, payload) => {
        if (!fromShell(event) || !isToastLayerRequest(payload)) {
          reject('overlay:toasts');
          return;
        }
        ctx.overlays.showToasts(payload);
      },
    ],
    [
      'ytm:message',
      (event, payload) => {
        if (!fromView(event) || typeof payload !== 'string' || payload.length > 4_000_000) {
          reject('ytm:message');
          return;
        }
        const message = parseBridgeEvent(payload);
        if (!message) {
          reject('ytm:message');
          return;
        }
        ctx.onBridgeEvent(message);
      },
    ],
    [
      'ytm:desktop',
      (event, payload) => {
        if (!fromViewAnyAllowed(event) || !isDesktopViewEvent(payload)) {
          reject('ytm:desktop');
          return;
        }
        const ytmOrigin = fromView(event);
        if (
          !ytmOrigin &&
          !(payload.type === 'contextMenu' && payload.target.kind === 'ytmText') &&
          payload.type !== 'dialog'
        ) {
          reject('ytm:desktop');
          return;
        }
        ctx.onDesktopEvent(payload);
      },
    ],
    [
      'window:control',
      (event, payload) => {
        if (!fromShell(event) || !isWindowControl(payload)) {
          reject('window:control');
          return;
        }
        ctx.windowControl(payload);
      },
    ],
    [
      'menu:open',
      (event, payload) => {
        if (!fromShell(event) || !isShellMenuRequest(payload)) {
          reject('menu:open');
          return;
        }
        ctx.openShellMenu(payload);
      },
    ],
    [
      'overlay:menu-select',
      (event, payload) => {
        if (!fromOverlay(event) || !isMenuAction(payload)) {
          reject('overlay:menu-select');
          return;
        }
        ctx.overlays.selectMenu(event.sender, payload);
      },
    ],
    [
      'overlay:menu-close',
      (event) => {
        if (!fromOverlay(event)) {
          reject('overlay:menu-close');
          return;
        }
        ctx.overlays.closeMenu();
      },
    ],
    [
      'ytm:key',
      (event, payload) => {
        if (!fromView(event) || !isKeyPayload(payload)) {
          reject('ytm:key');
          return;
        }
        sendToShell(ctx.win, 'shortcut:key', payload);
      },
    ],
    [
      'overlay:size',
      (event, payload) => {
        if (!fromOverlay(event) || !isOverlaySize(payload)) {
          reject('overlay:size');
          return;
        }
        ctx.overlays.handleSize(event.sender, payload);
      },
    ],
    [
      'overlay:toast-dismiss',
      (event, payload) => {
        if (!fromOverlay(event) || !isBoundedString(payload, 64)) {
          reject('overlay:toast-dismiss');
          return;
        }
        sendToShell(ctx.win, 'toast:dismiss', payload);
        if (!ctx.win.isDestroyed()) {
          ctx.win.webContents.focus();
        }
      },
    ],
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.on(channel, handler);
  }

  const invokeHandlers: [string, (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>][] = [
    [
      'app:get-initial',
      (event) => {
        if (!fromShell(event)) {
          return Promise.reject(new Error('Unauthorized sender'));
        }
        const data: InitialData = {
          settings: ctx.store.getSettings(),
          sidebarCollapsed: ctx.store.getWindowState().sidebarCollapsed,
          adblock: ctx.adblock.status(),
          account: ctx.account(),
          nav: ctx.view.navState(),
          viewStatus: ctx.view.currentStatus,
          version: ctx.version,
          systemDark: ctx.systemDark(),
          ytmBase: ctx.base,
          chrome: ctx.chrome(),
        };
        return Promise.resolve(data);
      },
    ],
    [
      'view:freeze',
      (event) => {
        if (!fromShell(event)) {
          return Promise.reject(new Error('Unauthorized sender'));
        }
        return ctx.view.freeze();
      },
    ],
    [
      'settings:set',
      (event, payload) => {
        if (!fromShell(event) || !isSettingsPatch(payload)) {
          return Promise.reject(new Error('Invalid settings update'));
        }
        const result = ctx.store.updateSettings(payload);
        return Promise.resolve<AppSettings>(result.settings);
      },
    ],
    [
      'settings:reset',
      (event) => {
        if (!fromShell(event)) {
          return Promise.reject(new Error('Unauthorized sender'));
        }
        return Promise.resolve(ctx.store.resetSettings());
      },
    ],
    [
      'adblock:update-now',
      (event) => {
        if (!fromShell(event)) {
          return Promise.reject(new Error('Unauthorized sender'));
        }
        return ctx.adblock.refresh();
      },
    ],
    [
      'data:clear-cache',
      async (event) => {
        if (!fromShell(event)) {
          throw new Error('Unauthorized sender');
        }
        await ctx.view.clearCache();
        return true;
      },
    ],
    [
      'lyrics:get',
      (event) => {
        if (!fromShell(event)) {
          return Promise.reject(new Error('Unauthorized sender'));
        }
        return ctx.lyrics();
      },
    ],
    [
      'search:suggest',
      (event, payload) => {
        if (!fromShell(event) || !isBoundedString(payload, 500)) {
          return Promise.reject(new Error('Invalid suggestion request'));
        }
        return ctx.suggest(payload);
      },
    ],
    [
      'data:sign-out',
      async (event) => {
        if (!fromShell(event)) {
          throw new Error('Unauthorized sender');
        }
        await ctx.view.signOut();
        ctx.onAccount({ signedIn: false, avatarUrl: '' });
        return true;
      },
    ],
  ];

  for (const [channel, handler] of invokeHandlers) {
    ipcMain.handle(channel, handler);
  }

  return () => {
    for (const [channel] of handlers) {
      ipcMain.removeAllListeners(channel);
    }
    for (const [channel] of invokeHandlers) {
      ipcMain.removeHandler(channel);
    }
  };
}

export function sendToShell<C extends ShellEventChannel>(
  win: BrowserWindow,
  channel: C,
  payload: ShellEventChannels[C],
): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }
  win.webContents.send(channel, payload);
}
