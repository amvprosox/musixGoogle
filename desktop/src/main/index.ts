import { app, BrowserWindow, Menu, nativeTheme, protocol, session } from 'electron';
import {
  ADBLOCK_FIRST_FETCH_TIMEOUT_MS,
  APP_DESKTOP_NAME,
  APP_ID,
  APP_NAME,
  YTM_PARTITION,
} from '../shared/constants';
import type { AccountState, AppSettings, PlayerCommand, PlayerState } from '../shared/types';
import { AdblockManager } from './adblock';
import {
  autostartExists,
  autostartFile,
  buildAutostartEntry,
  removeAutostart,
  writeAutostart,
} from './autostart';
import { isTestRun, userDataOverride, ytmBaseUrl } from './config';
import { registerIpc, sendToShell } from './ipc';
import { logError, logInfo, logWarn } from './log';
import { MprisManager } from './mpris';
import { TrackNotifier } from './notifications';
import { OverlayLayers } from './overlay';
import { hardenContents, installQuitAccelerator, registerMediaKeys, unregisterMediaKeys } from './shortcuts';
import { MenuController } from './menus';
import { toPlayerState, toQueueItems } from '../shared/bridge-adapter';
import { AppStore } from './store';
import { AppTray } from './tray';
import { startListRefreshSchedule } from './updater-lists';
import { ASSET_SCHEME, configureYtmSession, YtmView } from './view';
import { createMainWindow, currentTheme, showWindow, toggleWindow, WindowChrome } from './window';

const dataOverride = userDataOverride();
if (dataOverride) {
  app.setPath('userData', dataOverride);
}

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
}
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true },
  },
]);

let quitting = false;
let mainWindow: BrowserWindow | null = null;
const disposers: (() => void)[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requestQuit(): void {
  quitting = true;
  app.quit();
}

function autostartExec(): string[] {
  const appImage = process.env.APPIMAGE;
  if (typeof appImage === 'string' && appImage !== '') {
    return [appImage, '--hidden'];
  }
  if (app.isPackaged) {
    return [process.execPath, '--hidden'];
  }
  return [process.execPath, app.getAppPath(), '--hidden'];
}

async function applyAutostart(enabled: boolean): Promise<void> {
  if (process.platform !== 'linux') {
    if (!app.isPackaged) {
      return;
    }
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
    return;
  }
  const file = autostartFile(APP_DESKTOP_NAME);
  if (enabled) {
    await writeAutostart(
      file,
      buildAutostartEntry({
        name: APP_NAME,
        comment: 'YouTube Music desktop player',
        exec: autostartExec(),
        icon: APP_DESKTOP_NAME,
        wmClass: APP_NAME,
      }),
    );
    return;
  }
  if (await autostartExists(file)) {
    await removeAutostart(file);
  }
}

function applicationMenu(): Menu | null {
  if (process.platform !== 'darwin') {
    return null;
  }
  return Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]);
}

async function start(): Promise<void> {
  Menu.setApplicationMenu(applicationMenu());
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  const store = new AppStore();
  const initialSettings = store.getSettings();
  nativeTheme.themeSource = initialSettings.theme;

  const ytmSession = session.fromPartition(YTM_PARTITION);
  configureYtmSession(ytmSession);

  const adblock = new AdblockManager(ytmSession, app.getPath('userData'), initialSettings.adblockEnabled);
  const adblockReady = adblock.init().catch((error: unknown) => {
    logError('adblock', 'Initial engine load failed', error);
  });

  const startHidden = process.argv.includes('--hidden') && initialSettings.closeToTray;
  const devMode = process.argv.includes('--dev') || isTestRun();
  const win = createMainWindow({ store, startHidden, isQuitting: () => quitting, devTools: devMode });
  mainWindow = win;
  hardenContents(win.webContents, devMode);
  const chrome = new WindowChrome(win, (state) => {
    sendToShell(win, 'window:chrome', state);
  });

  const base = ytmBaseUrl();
  let lastState: PlayerState | null = null;
  let lastStateAt = 0;
  let account: AccountState = { signedIn: false, avatarUrl: '' };
  const setAccount = (next: AccountState): void => {
    if (next.signedIn === account.signedIn && next.avatarUrl === account.avatarUrl) {
      return;
    }
    account = next;
    sendToShell(win, 'account:state', next);
  };

  const view = new YtmView(
    win,
    ytmSession,
    base,
    {
      onStatus: (status) => {
        sendToShell(win, 'view:status', status);
      },
      onNav: (nav) => {
        sendToShell(win, 'view:nav', nav);
        sendToShell(win, 'view:progress', 'done');
      },
    },
    { adSkipFallback: initialSettings.adSkipFallback },
    () => quitting,
    () => lastState,
    devMode,
  );
  hardenContents(view.webContents, devMode);
  view.webContents.on('did-create-window', (child) => {
    hardenContents(child.webContents, devMode);
  });
  const overlays = new OverlayLayers(win, () => currentTheme(store), devMode);
  for (const layer of overlays.views()) {
    hardenContents(layer.webContents, devMode);
  }
  const menus = new MenuController({
    overlays,
    view,
    shellContents: () => (win.isDestroyed() ? null : win.webContents),
    notify: (title, message) => {
      sendToShell(win, 'notice', { variant: 'success', title, message });
    },
  });
  const viewOffset = (): { x: number; y: number } => {
    const bounds = view.view.getBounds();
    return { x: bounds.x, y: bounds.y };
  };

  const command = (cmd: PlayerCommand): void => {
    view.command(cmd);
  };

  const tray = new AppTray(win, {
    command,
    toggleWindow: () => {
      toggleWindow(win);
    },
    quit: requestQuit,
  });
  const mpris =
    process.platform === 'linux'
      ? new MprisManager(command, () => {
          showWindow(win);
        })
      : null;
  const notifier = new TrackNotifier(win, ytmSession, () => store.getSettings().notifyOnTrackChange);

  disposers.push(
    registerIpc({
      win,
      view,
      overlays,
      store,
      adblock,
      base,
      version: app.getVersion(),
      systemDark: () => nativeTheme.shouldUseDarkColors,
      quit: requestQuit,
      account: () => account,
      onAccount: setAccount,
      windowControl: (action) => {
        chrome.control(action);
      },
      chrome: () => chrome.state(),
      openShellMenu: (request) => {
        if (request.target.kind === 'shellText') {
          menus.open({ kind: 'shellText' }, request.x, request.y, {
            title: '',
            actions: ['cut', 'copy', 'paste', 'selectAll'],
          });
          return;
        }
        menus.requestItemMenu(request.target, request.x, request.y);
      },
      onDesktopEvent: (event) => {
        switch (event.type) {
          case 'contextMenu': {
            const offset = viewOffset();
            menus.open(event.target, event.x + offset.x, event.y + offset.y, event.info);
            return;
          }
          case 'itemInfo':
            menus.resolveItemInfo(event.requestId, event.info);
            return;
          case 'link':
            menus.copyLink(event.url);
            return;
          case 'tooltip': {
            const offset = viewOffset();
            overlays.showTooltip({
              text: event.text,
              anchor: {
                x: event.rect.x + offset.x,
                y: event.rect.y + offset.y,
                width: event.rect.width,
                height: event.rect.height,
              },
              placement: 'bottom',
            });
            return;
          }
          case 'tooltipHide':
            overlays.showTooltip(null);
            return;
          case 'dialog':
            sendToShell(win, 'dialog:show', { kind: event.kind, message: event.message });
            return;
          case 'navStart':
            sendToShell(win, 'view:progress', 'start');
            return;
        }
      },
      onBridgeEvent: (event) => {
        switch (event.type) {
          case 'ready':
            view.markBridgeReady();
            return;
          case 'state': {
            const state = toPlayerState(event.state);
            const now = Date.now();
            if (lastState && lastState.videoId === state.videoId && lastState.isPlaying) {
              const expected = lastState.currentTimeSec + (now - lastStateAt) / 1000;
              if (Math.abs(state.currentTimeSec - expected) > 2) {
                mpris?.notifySeeked(state.currentTimeSec);
              }
            }
            lastState = state;
            lastStateAt = now;
            sendToShell(win, 'player:state', state);
            tray.update(state);
            mpris?.update(state);
            notifier.handle(state);
            return;
          }
          case 'queue':
            sendToShell(win, 'player:queue', toQueueItems(event.items));
            return;
          case 'signedIn':
            setAccount({ signedIn: true, avatarUrl: event.avatarUrl });
            return;
          case 'signedOut':
            setAccount({ signedIn: false, avatarUrl: '' });
            return;
          case 'error':
            if (event.code !== 'not_ready') {
              logWarn('bridge', `${event.code}: ${event.message}`);
            }
            return;
          case 'adStart':
          case 'adEnd':
          case 'ack':
          case 'browseResult':
          case 'searchResult':
            return;
        }
      },
    }),
  );

  disposers.push(
    adblock.onStatus((status) => {
      sendToShell(win, 'adblock:status', status);
    }),
  );
  disposers.push(startListRefreshSchedule(adblock));

  disposers.push(
    store.onSettingsChanged((settings: AppSettings, changed) => {
      sendToShell(win, 'settings:changed', settings);
      if (changed.includes('theme')) {
        nativeTheme.themeSource = settings.theme;
        overlays.refreshTheme();
      }
      if (changed.includes('adblockEnabled')) {
        adblock.setEnabled(settings.adblockEnabled);
      }
      if (changed.includes('adSkipFallback')) {
        view.setConfig({ adSkipFallback: settings.adSkipFallback });
      }
      if (changed.includes('startOnLogin')) {
        applyAutostart(settings.startOnLogin).catch((error: unknown) => {
          logError('autostart', 'Failed to update autostart entry', error);
        });
      }
    }),
  );

  const onThemeUpdated = (): void => {
    sendToShell(win, 'theme:system', nativeTheme.shouldUseDarkColors);
    overlays.refreshTheme();
  };
  nativeTheme.on('updated', onThemeUpdated);
  disposers.push(() => {
    nativeTheme.removeListener('updated', onThemeUpdated);
  });

  installQuitAccelerator(win.webContents, requestQuit);
  installQuitAccelerator(view.webContents, requestQuit);
  registerMediaKeys(command);

  applyAutostart(initialSettings.startOnLogin).catch((error: unknown) => {
    logWarn('autostart', 'Could not reconcile autostart entry', error);
  });

  disposers.push(() => {
    unregisterMediaKeys();
    mpris?.dispose();
    notifier.dispose();
    tray.dispose();
    view.dispose();
    adblock.dispose();
  });

  await Promise.race([adblockReady, delay(ADBLOCK_FIRST_FETCH_TIMEOUT_MS)]);
  if (!adblock.status().ready) {
    logWarn('adblock', 'Engine not ready yet, loading YouTube Music without network blocking for now');
  }
  view.start();
  logInfo('main', 'Started');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      showWindow(mainWindow);
    }
  });

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showWindow(mainWindow);
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    while (disposers.length > 0) {
      const dispose = disposers.pop();
      if (dispose) {
        try {
          dispose();
        } catch (error) {
          logError('main', 'Dispose failed', error);
        }
      }
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logInfo('main', `Received ${signal}, quitting`);
      requestQuit();
    });
  }

  process.on('unhandledRejection', (reason) => {
    logError('main', 'Unhandled promise rejection', reason);
  });

  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      logError('main', 'Startup failed', error);
      app.quit();
    });
}
