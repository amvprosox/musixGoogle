import { app, BrowserWindow, Menu, nativeTheme, protocol, session } from 'electron';
import {
  ADBLOCK_FIRST_FETCH_TIMEOUT_MS,
  APP_DESKTOP_NAME,
  APP_ID,
  APP_NAME,
  YTM_PARTITION,
} from '../shared/constants';
import type { BridgeCommand, BridgeEvent, BrowsePage, FlatItem } from '@musix/bridge/contract';
import type {
  AccountState,
  AppSettings,
  DetectedLibrary,
  DownloadTrackRequest,
  LyricsResponse,
  PlayerCommand,
  PlayerState,
  SuggestResponse,
} from '../shared/types';
import { AdblockManager } from './adblock';
import {
  autostartExists,
  autostartFile,
  buildAutostartEntry,
  removeAutostart,
  writeAutostart,
} from './autostart';
import { isTestRun, userDataOverride, ytmBaseUrl } from './config';
import { DownloadManager } from './downloads';
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
import { ASSET_SCHEME, configureAssetProtocol, configureYtmSession, YtmView } from './view';
import { createMainWindow, currentTheme, showWindow, toggleWindow, WindowChrome } from './window';

const LYRICS_TIMEOUT_MS = 30_000;
const SUGGEST_TIMEOUT_MS = 5_000;
const BROWSE_TIMEOUT_MS = 12_000;
const LIBRARY_MAX_TRACKS = 5000;
const LIBRARY_MAX_CONTINUATIONS = 60;
const LIBRARY_MAX_PLAYLISTS = 25;
const LIBRARY_MAX_ALBUMS = 15;
const LIBRARY_BROWSE_PARALLEL = 4;

function extractPlayableTracks(page: BrowsePage): DownloadTrackRequest[] {
  const results: DownloadTrackRequest[] = [];
  const seen = new Set<string>();
  const allItems: FlatItem[] = [...page.items];
  for (const section of page.sections) {
    allItems.push(...section.items);
  }
  for (const item of allItems) {
    if (!item.videoId || seen.has(item.videoId) || item.title.trim() === '') {
      continue;
    }
    seen.add(item.videoId);
    const parts = item.subtitle
      .split('•')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    results.push({
      videoId: item.videoId,
      title: item.title.trim(),
      artist: parts[0] ?? '',
      album: parts[1] ?? '',
      durationSec: item.durationSec && item.durationSec > 0 ? item.durationSec : 0,
      artworkUrl: item.artworkUrl,
    });
  }
  return results;
}

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
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true,
    },
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
  let ytmViewRef: YtmView | null = null;
  const downloads = new DownloadManager(app.getPath('userData'), ytmSession, () =>
    ytmViewRef ? ytmViewRef.webContents : null,
  );
  configureAssetProtocol(session.defaultSession, downloads.downloadsDir);
  configureYtmSession(ytmSession, downloads.downloadsDir);

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
  ytmViewRef = view;
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

  const pendingRequests = new Map<
    string,
    { resolve: (event: BridgeEvent | null) => void; timer: NodeJS.Timeout }
  >();
  const settleRequest = (requestId: string, event: BridgeEvent | null): boolean => {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }
    pendingRequests.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(event);
    return true;
  };
  const requestBridge = (request: BridgeCommand, timeoutMs: number): Promise<BridgeEvent | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        settleRequest(request.requestId, null);
      }, timeoutMs);
      pendingRequests.set(request.requestId, { resolve, timer });
      if (!view.sendBridge(request)) {
        settleRequest(request.requestId, null);
      }
    });
  const lyrics = async (): Promise<LyricsResponse> => {
    const state = lastState;
    const videoId = state ? state.videoId : '';
    if (!state || !state.hasTrack || state.isAd || videoId === '' || state.durationSec <= 0) {
      return { kind: 'missing', videoId };
    }
    const event = await requestBridge(
      {
        v: 1,
        type: 'lyrics',
        requestId: view.nextRequestId(),
        videoId,
        title: state.title,
        artist: state.artist,
        album: state.album,
        durationSec: state.durationSec,
      },
      LYRICS_TIMEOUT_MS,
    );
    if (!event) {
      return { kind: 'error', videoId, message: 'YouTube Music did not respond. Try again.' };
    }
    if (event.type === 'lyricsResult') {
      return event.lyrics ? { kind: 'found', lyrics: event.lyrics } : { kind: 'missing', videoId };
    }
    if (event.type === 'error') {
      return { kind: 'error', videoId, message: event.message };
    }
    return { kind: 'missing', videoId };
  };
  const suggest = async (query: string): Promise<SuggestResponse> => {
    const trimmed = query.trim();
    if (trimmed === '') {
      return { query: '', queries: [], items: [] };
    }
    const event = await requestBridge(
      { v: 1, type: 'suggest', requestId: view.nextRequestId(), query: trimmed },
      SUGGEST_TIMEOUT_MS,
    );
    return event && event.type === 'suggestResult' ? event.suggestions : null;
  };
  const browseNode = async (nodeId: string): Promise<BrowsePage | null> => {
    const event = await requestBridge(
      { v: 1, type: 'browse', requestId: view.nextRequestId(), nodeId },
      BROWSE_TIMEOUT_MS,
    );
    return event && event.type === 'browseResult' ? event.page : null;
  };
  const browseAll = async (nodeId: string): Promise<BrowsePage | null> => {
    const first = await browseNode(nodeId);
    if (!first) {
      return null;
    }
    const items = [...first.items];
    let token = first.continuation;
    for (
      let round = 0;
      token && round < LIBRARY_MAX_CONTINUATIONS && items.length < LIBRARY_MAX_TRACKS;
      round += 1
    ) {
      const event = await requestBridge(
        { v: 1, type: 'loadContinuation', requestId: view.nextRequestId(), token, kind: 'browse', nodeId },
        BROWSE_TIMEOUT_MS,
      );
      if (!event || event.type !== 'browseResult' || event.page.items.length === 0) {
        break;
      }
      items.push(...event.page.items);
      token = event.page.continuation !== token ? event.page.continuation : null;
    }
    return { ...first, items, continuation: null };
  };
  const detectLibraries = async (): Promise<DetectedLibrary[]> => {
    const libraries: DetectedLibrary[] = [];
    const seenIds = new Set<string>();
    const pushLibrary = (
      id: string,
      title: string,
      subtitle: string,
      artworkUrl: string,
      tracks: DownloadTrackRequest[],
    ): void => {
      if (tracks.length === 0 || seenIds.has(id)) {
        return;
      }
      seenIds.add(id);
      libraries.push({
        id,
        title,
        subtitle,
        artworkUrl: artworkUrl || tracks[0]?.artworkUrl || '',
        tracks,
      });
    };

    const [likedPage, recentPage, playlistsPage, albumsPage] = await Promise.all([
      browseAll('library-liked'),
      browseNode('recent'),
      browseAll('playlists'),
      browseAll('library-albums'),
    ]);

    if (likedPage) {
      const tracks = extractPlayableTracks(likedPage);
      pushLibrary('library-liked', 'Liked Music', `${tracks.length} songs`, '', tracks);
    }
    if (recentPage) {
      const tracks = extractPlayableTracks(recentPage);
      pushLibrary('recent', 'Recently Played', `${tracks.length} songs`, '', tracks);
    }

    const collectionItems: { id: string; title: string; artworkUrl: string; kind: string }[] = [];
    const collectionIds = new Set<string>();
    const addCollections = (page: BrowsePage | null, kind: string, limit: number): void => {
      if (!page) {
        return;
      }
      let added = 0;
      for (const item of [...page.items, ...page.sections.flatMap((s) => s.items)]) {
        if (added >= limit) {
          return;
        }
        const id = item.browseId;
        if (!id || id === 'VLLM' || id === 'LM' || item.title.trim() === '' || collectionIds.has(id)) {
          continue;
        }
        collectionIds.add(id);
        collectionItems.push({ id, title: item.title.trim(), artworkUrl: item.artworkUrl, kind });
        added += 1;
      }
    };
    addCollections(playlistsPage, 'Playlist', LIBRARY_MAX_PLAYLISTS);
    addCollections(albumsPage, 'Album', LIBRARY_MAX_ALBUMS);

    const cappedCollections = collectionItems;
    const pages: (BrowsePage | null)[] = [];
    for (let start = 0; start < cappedCollections.length; start += LIBRARY_BROWSE_PARALLEL) {
      const chunk = cappedCollections.slice(start, start + LIBRARY_BROWSE_PARALLEL);
      pages.push(...(await Promise.all(chunk.map((col) => browseAll(col.id)))));
    }
    for (let i = 0; i < cappedCollections.length; i += 1) {
      const col = cappedCollections[i];
      const page = pages[i];
      if (!col || !page) {
        continue;
      }
      const tracks = extractPlayableTracks(page);
      pushLibrary(col.id, col.title, `${col.kind} • ${tracks.length} songs`, col.artworkUrl, tracks);
    }

    if (libraries.length === 0) {
      const homePage = await browseNode('home');
      if (homePage) {
        for (const section of homePage.sections) {
          const sectionTracks = extractPlayableTracks({
            nodeId: section.id,
            title: section.title,
            sections: [],
            items: section.items,
            continuation: null,
          });
          if (sectionTracks.length > 0) {
            pushLibrary(
              `home:${section.id}`,
              section.title || 'Home Picks',
              `${sectionTracks.length} songs`,
              sectionTracks[0]?.artworkUrl ?? '',
              sectionTracks,
            );
          }
        }
      }
    }

    downloads.appendLog(`Detected ${libraries.length} library collection(s)`);
    return libraries;
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
      downloads,
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
      lyrics,
      suggest,
      detectLibraries,
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
          case 'lyricsResult':
          case 'suggestResult':
          case 'browseResult':
            settleRequest(event.requestId, event);
            return;
          case 'error':
            if (event.requestId !== null && settleRequest(event.requestId, event)) {
              return;
            }
            if (event.code !== 'not_ready') {
              logWarn('bridge', `${event.code}: ${event.message}`);
            }
            return;
          case 'adStart':
          case 'adEnd':
          case 'ack':
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
  disposers.push(
    downloads.onChanged((items) => {
      sendToShell(win, 'downloads:changed', items);
    }),
  );
  disposers.push(
    downloads.onLogsChanged((logs) => {
      sendToShell(win, 'downloads:logs-changed', logs);
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
    downloads.dispose();
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
