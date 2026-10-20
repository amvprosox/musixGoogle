import { BrowserWindow, shell, WebContentsView, type Session, type WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { YTM_PARTITION } from '../shared/constants';
import { roundRect } from '../shared/policies';
import {
  isExternalOpenable,
  isGoogleSignInUrl,
  isInViewAllowedUrl,
  isSameOrigin,
  ytmRouteUrl,
  ytmSearchUrl,
} from '../shared/routes';
import type {
  HistoryDirection,
  DesktopViewCommand,
  PlayerCommand,
  PlayerState,
  ViewLayout,
  ViewNavState,
  ViewStatus,
  YtmConfig,
} from '../shared/types';
import type { BridgeCommand } from '@musix/bridge/contract';
import { routeCommand } from '../shared/bridge-adapter';
import { YTM_INJECTED_CSS } from '../shared/ytm-css';
import { accountRequestHeaders, firefoxUserAgent, isGoogleAccountsUrl } from '../shared/identity';
import { chromeUserAgent, paths } from './config';
import { logError, logInfo, logWarn } from './log';

export const ASSET_SCHEME = 'musix-asset';

const FONT_FILE_PATTERN = /^[a-z0-9-]+\.woff2$/;

export function configureYtmSession(ses: Session): void {
  ses.setUserAgent(chromeUserAgent());
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (details, callback) => {
    if (!isGoogleAccountsUrl(details.url)) {
      callback({});
      return;
    }
    callback({ requestHeaders: accountRequestHeaders(details.requestHeaders, firefoxUserAgent(new Date())) });
  });
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'notifications');
  });
  ses.setPermissionCheckHandler(
    (_wc, permission) => permission === 'media' || permission === 'notifications',
  );
  if (!ses.protocol.isProtocolHandled(ASSET_SCHEME)) {
    ses.protocol.handle(ASSET_SCHEME, async (request) => {
      try {
        const url = new URL(request.url);
        const name = path.basename(url.pathname);
        if (url.hostname !== 'fonts' || !FONT_FILE_PATTERN.test(name)) {
          return new Response(null, { status: 404 });
        }
        const data = await fs.readFile(path.join(paths.fontsDir, name));
        return new Response(new Uint8Array(data), {
          status: 200,
          headers: {
            'content-type': 'font/woff2',
            'access-control-allow-origin': '*',
            'cache-control': 'max-age=31536000',
          },
        });
      } catch (error) {
        logWarn('view', 'Font request failed', error);
        return new Response(null, { status: 404 });
      }
    });
  }
}

function applyIdentity(contents: WebContents, url: string): void {
  const wanted = isGoogleAccountsUrl(url) ? firefoxUserAgent(new Date()) : chromeUserAgent();
  if (contents.getUserAgent() !== wanted) {
    contents.setUserAgent(wanted);
  }
}

export interface ViewEvents {
  onStatus: (status: ViewStatus) => void;
  onNav: (nav: ViewNavState) => void;
}

export class YtmView {
  readonly view: WebContentsView;
  private status: ViewStatus = { kind: 'loading' };
  private lastUrl: string;
  private layout: ViewLayout = { bounds: { x: 0, y: 0, width: 0, height: 0 }, visible: false };
  private recoverTimer: NodeJS.Timeout | null = null;
  private signInWindow: BrowserWindow | null = null;
  private config: YtmConfig;
  private navigationFailed = false;
  private disposed = false;
  private bridgeReady = false;
  private cssKey: string | null = null;
  private requestCounter = 0;

  constructor(
    private readonly win: BrowserWindow,
    private readonly ses: Session,
    private readonly base: string,
    private readonly events: ViewEvents,
    config: YtmConfig,
    private readonly isQuitting: () => boolean,
    private readonly currentState: () => PlayerState | null,
    devTools: boolean,
  ) {
    this.lastUrl = ytmRouteUrl('home', base);
    this.config = config;
    this.view = new WebContentsView({
      webPreferences: {
        partition: YTM_PARTITION,
        preload: paths.ytmPreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        devTools,
        additionalArguments: [`--musix-ytm-base=${base}`],
      },
    });
    this.view.webContents.setMaxListeners(64);
    this.view.setBackgroundColor('#030303');
    this.view.setVisible(false);
    this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    win.contentView.addChildView(this.view);
    this.wire();
  }

  get webContents(): Electron.WebContents {
    return this.view.webContents;
  }

  get currentStatus(): ViewStatus {
    return this.status;
  }

  private setStatus(status: ViewStatus): void {
    this.status = status;
    this.events.onStatus(status);
  }

  navState(): ViewNavState {
    const wc = this.view.webContents;
    if (wc.isDestroyed()) {
      return { url: this.lastUrl, canGoBack: false, canGoForward: false };
    }
    return {
      url: wc.getURL(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
  }

  private emitNav(): void {
    this.events.onNav(this.navState());
  }

  private wire(): void {
    const wc = this.view.webContents;

    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        applyIdentity(wc, details.url);
        this.navigationFailed = false;
        this.bridgeReady = false;
        this.cssKey = null;
        this.setStatus({ kind: 'loading' });
      }
    });

    wc.on('did-finish-load', () => {
      if (this.navigationFailed) {
        this.emitNav();
        return;
      }
      this.setStatus({ kind: 'ready' });
      this.emitNav();
    });

    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      logWarn('view', `Load failed (${errorCode}) ${errorDescription} for ${validatedURL}`);
      this.navigationFailed = true;
      this.setStatus({ kind: 'error', code: errorCode, description: errorDescription });
    });

    wc.on('render-process-gone', (_event, details) => {
      if (this.disposed || this.isQuitting()) {
        return;
      }
      logWarn('view', `Renderer gone (${details.reason}), recovering`);
      this.setStatus({ kind: 'crashed', reason: details.reason });
      if (this.recoverTimer) {
        clearTimeout(this.recoverTimer);
      }
      this.recoverTimer = setTimeout(() => {
        this.recoverTimer = null;
        this.setStatus({ kind: 'recovering' });
        this.load(this.lastUrl);
      }, 1200);
    });

    wc.on('did-navigate', (_event, url) => {
      this.trackUrl(url);
      this.refreshStyles(url);
      this.emitNav();
    });

    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      this.trackUrl(url);
      this.refreshStyles(url);
      this.emitNav();
    });

    wc.on('will-navigate', (event) => {
      if (isInViewAllowedUrl(event.url, this.base)) {
        return;
      }
      event.preventDefault();
      this.openExternal(event.url);
    });

    wc.setWindowOpenHandler(({ url }) => {
      if (isGoogleSignInUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: this.win,
            width: 520,
            height: 720,
            autoHideMenuBar: true,
            title: 'Sign in',
            webPreferences: {
              partition: YTM_PARTITION,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }
      this.openExternal(url);
      return { action: 'deny' };
    });

    wc.on('did-create-window', (child) => {
      this.adoptSignInWindow(child);
    });
  }

  private adoptSignInWindow(child: BrowserWindow): void {
    if (this.signInWindow && !this.signInWindow.isDestroyed()) {
      this.signInWindow.close();
    }
    this.signInWindow = child;
    child.webContents.setMaxListeners(64);
    applyIdentity(child.webContents, child.webContents.getURL());
    child.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        applyIdentity(child.webContents, details.url);
      }
    });
    child.webContents.setWindowOpenHandler(({ url }) => {
      this.openExternal(url);
      return { action: 'deny' };
    });
    child.webContents.on('will-navigate', (event) => {
      if (isInViewAllowedUrl(event.url, this.base)) {
        return;
      }
      event.preventDefault();
      this.openExternal(event.url);
    });
    child.webContents.on('did-navigate', (_event, url) => {
      if (isSameOrigin(url, this.base)) {
        child.close();
        this.load(this.lastUrl);
      }
    });
    child.on('closed', () => {
      if (this.signInWindow === child) {
        this.signInWindow = null;
      }
    });
  }

  private openExternal(url: string): void {
    if (!isExternalOpenable(url)) {
      return;
    }
    shell.openExternal(url).catch((error: unknown) => {
      logError('view', 'Failed to open external link', error);
    });
  }

  private trackUrl(url: string): void {
    if (isSameOrigin(url, this.base)) {
      this.lastUrl = url;
    }
  }

  load(url: string): void {
    const wc = this.view.webContents;
    if (wc.isDestroyed()) {
      return;
    }
    this.setStatus({ kind: 'loading' });
    wc.loadURL(url).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ERR_ABORTED')) {
        return;
      }
      logWarn('view', `loadURL rejected for ${url}`, error);
    });
  }

  start(): void {
    logInfo('view', `Loading ${this.base}`);
    this.load(ytmRouteUrl('home', this.base));
  }

  reload(): void {
    this.load(this.lastUrl);
  }

  setLayout(layout: ViewLayout): void {
    this.layout = { bounds: roundRect(layout.bounds), visible: layout.visible };
    this.applyLayout();
  }

  applyLayout(): void {
    if (this.view.webContents.isDestroyed()) {
      return;
    }
    const { bounds, visible } = this.layout;
    this.view.setBounds(bounds);
    this.view.setVisible(visible && bounds.width > 0 && bounds.height > 0);
  }

  async freeze(): Promise<string | null> {
    const wc = this.view.webContents;
    if (wc.isDestroyed() || !this.view.getVisible()) {
      return null;
    }
    try {
      const image = await wc.capturePage();
      if (image.isEmpty()) {
        return null;
      }
      return `data:image/jpeg;base64,${image.toJPEG(82).toString('base64')}`;
    } catch (error) {
      logWarn('view', 'Capture failed', error);
      return null;
    }
  }

  private refreshStyles(url: string): void {
    const wc = this.view.webContents;
    if (wc.isDestroyed() || !isSameOrigin(url, this.base)) {
      return;
    }
    const previous = this.cssKey;
    wc.insertCSS(YTM_INJECTED_CSS)
      .then((key) => {
        this.cssKey = key;
        if (previous !== null && !wc.isDestroyed()) {
          return wc.removeInsertedCSS(previous);
        }
        return undefined;
      })
      .catch((error: unknown) => {
        logWarn('view', 'Could not refresh injected styles', error);
      });
  }

  nextRequestId(): string {
    this.requestCounter += 1;
    return `d${this.requestCounter}`;
  }

  markBridgeReady(): void {
    this.bridgeReady = true;
    this.sendBridge({
      v: 1,
      type: 'configure',
      requestId: this.nextRequestId(),
      adSkip: this.config.adSkipFallback,
    });
  }

  isBridgeReady(): boolean {
    return this.bridgeReady;
  }

  sendBridge(command: BridgeCommand): boolean {
    const wc = this.view.webContents;
    if (wc.isDestroyed() || !this.bridgeReady) {
      return false;
    }
    wc.send('ytm:command', JSON.stringify(command));
    return true;
  }

  sendDesktop(command: DesktopViewCommand): boolean {
    const wc = this.view.webContents;
    if (wc.isDestroyed()) {
      return false;
    }
    if (this.status.kind !== 'ready') {
      if (command.type === 'navigate') {
        this.load(ytmRouteUrl(command.route, this.base));
        return true;
      }
      if (command.type === 'searchPage') {
        this.load(ytmSearchUrl(command.query, this.base));
        return true;
      }
      return false;
    }
    wc.send('ytm:desktop-command', command);
    return true;
  }

  command(command: PlayerCommand): void {
    const routed = routeCommand(command, this.currentState(), this.nextRequestId());
    if (routed.channel === 'desktop') {
      this.sendDesktop(routed.command);
      return;
    }
    if (!this.sendBridge(routed.command)) {
      logWarn('view', `Dropped ${routed.command.type}: player is not ready`);
    }
  }

  history(direction: HistoryDirection): void {
    const wc = this.view.webContents;
    if (wc.isDestroyed()) {
      return;
    }
    const history = wc.navigationHistory;
    if (direction === 'back' && history.canGoBack()) {
      history.goBack();
    }
    if (direction === 'forward' && history.canGoForward()) {
      history.goForward();
    }
  }

  setConfig(config: YtmConfig): void {
    this.config = config;
    this.sendBridge({
      v: 1,
      type: 'configure',
      requestId: this.nextRequestId(),
      adSkip: config.adSkipFallback,
    });
  }

  async clearCache(): Promise<void> {
    await this.ses.clearCache();
  }

  async signOut(): Promise<void> {
    await this.ses.clearStorageData();
    await this.ses.clearCache();
    this.load(ytmRouteUrl('home', this.base));
  }

  isFromView(contents: Electron.WebContents): boolean {
    return !this.view.webContents.isDestroyed() && contents.id === this.view.webContents.id;
  }

  dispose(): void {
    this.disposed = true;
    if (this.recoverTimer) {
      clearTimeout(this.recoverTimer);
      this.recoverTimer = null;
    }
    if (this.signInWindow && !this.signInWindow.isDestroyed()) {
      this.signInWindow.destroy();
    }
  }
}
