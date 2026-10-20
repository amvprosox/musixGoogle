import { BrowserWindow, nativeTheme, screen, shell } from 'electron';
import { execFile } from 'node:child_process';
import { parseButtonLayout } from '../shared/bridge-adapter';
import { BOOT_ARG_PREFIX } from '../shared/channels';
import { APP_NAME, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '../shared/constants';
import { isBoundsVisibleOnDisplays } from '../shared/policies';
import { isExternalOpenable } from '../shared/routes';
import { resolveTheme } from '../shared/settings';
import type {
  BootInfo,
  ResolvedTheme,
  WindowButton,
  WindowChromeState,
  WindowControl,
} from '../shared/types';
import { desktopPlatform } from '../shared/types';
import { appIconPath, paths } from './config';
import { logError } from './log';
import type { AppStore } from './store';

export const THEME_BACKGROUND: Readonly<Record<ResolvedTheme, string>> = {
  dark: '#0f1420',
  light: '#f6f7fb',
};

export interface MainWindowOptions {
  store: AppStore;
  startHidden: boolean;
  isQuitting: () => boolean;
  devTools: boolean;
}

export function currentTheme(store: AppStore): ResolvedTheme {
  return resolveTheme(store.getSettings().theme, nativeTheme.shouldUseDarkColors);
}

function encodeBoot(info: BootInfo): string {
  return `${BOOT_ARG_PREFIX}${Buffer.from(JSON.stringify(info), 'utf8').toString('base64')}`;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const { store } = options;
  const state = store.getWindowState();
  const settings = store.getSettings();
  const theme = currentTheme(store);
  const displays = screen.getAllDisplays().map((display) => display.workArea);
  const hasPosition =
    state.x !== null &&
    state.y !== null &&
    isBoundsVisibleOnDisplays({ x: state.x, y: state.y, width: state.width, height: state.height }, displays);

  const boot: BootInfo = {
    theme,
    themePreference: settings.theme,
    sidebarCollapsed: state.sidebarCollapsed,
    platform: desktopPlatform(process.platform),
  };
  const windows = process.platform === 'win32';

  const win = new BrowserWindow({
    title: APP_NAME,
    width: state.width,
    height: state.height,
    ...(hasPosition && state.x !== null && state.y !== null ? { x: state.x, y: state.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: !windows,
    resizable: true,
    hasShadow: true,
    backgroundColor: windows ? THEME_BACKGROUND[theme] : '#00000000',
    icon: appIconPath(512),
    autoHideMenuBar: true,
    webPreferences: {
      devTools: options.devTools,
      preload: paths.shellPreload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      additionalArguments: [encodeBoot(boot)],
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalOpenable(url)) {
      shell.openExternal(url).catch((error: unknown) => {
        logError('window', 'Failed to open external link', error);
      });
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  win.once('ready-to-show', () => {
    if (options.startHidden) {
      return;
    }
    if (state.isMaximized) {
      win.maximize();
    }
    win.show();
  });

  let saveTimer: NodeJS.Timeout | null = null;
  const persistBounds = (): void => {
    if (win.isDestroyed()) {
      return;
    }
    if (win.isMaximized() || win.isMinimized() || win.isFullScreen()) {
      store.saveWindowState({ isMaximized: win.isMaximized() });
      return;
    }
    const bounds = win.getBounds();
    store.saveWindowState({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: false,
    });
  };
  const schedulePersist = (): void => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(persistBounds, 400);
  };

  win.on('resize', schedulePersist);
  win.on('move', schedulePersist);
  win.on('maximize', schedulePersist);
  win.on('unmaximize', schedulePersist);

  win.on('close', (event) => {
    persistBounds();
    if (!options.isQuitting() && store.getSettings().closeToTray) {
      event.preventDefault();
      win.hide();
    }
  });

  win.loadFile(paths.shellHtml).catch((error: unknown) => {
    logError('window', 'Failed to load shell', error);
  });

  return win;
}

export function showWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }
  win.focus();
}

export function toggleWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
    return;
  }
  showWindow(win);
}

export function readButtonLayout(): Promise<string> {
  if (process.platform !== 'linux') {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    execFile(
      'gsettings',
      ['get', 'org.gnome.desktop.wm.preferences', 'button-layout'],
      { timeout: 2000 },
      (error, stdout) => {
        resolve(error ? '' : stdout);
      },
    );
  });
}

export class WindowChrome {
  private layout: { side: 'left' | 'right'; buttons: WindowButton[] } = {
    side: 'right',
    buttons: ['minimize', 'maximize', 'close'],
  };
  private lastMaximizeChange = 0;

  constructor(
    private readonly win: BrowserWindow,
    private readonly publish: (state: WindowChromeState) => void,
  ) {
    for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
      win.on(event as 'maximize', () => {
        this.lastMaximizeChange = Date.now();
        this.emit();
      });
    }
    for (const event of ['focus', 'blur'] as const) {
      win.on(event as 'focus', () => {
        this.emit();
      });
    }
    readButtonLayout()
      .then((raw) => {
        this.layout = parseButtonLayout(raw);
        this.emit();
      })
      .catch((error: unknown) => {
        logError('window', 'Could not read the window button layout', error);
      });
  }

  state(): WindowChromeState {
    if (this.win.isDestroyed()) {
      return { maximized: false, fullscreen: false, focused: false, ...this.layout };
    }
    return {
      maximized: this.win.isMaximized(),
      fullscreen: this.win.isFullScreen(),
      focused: this.win.isFocused(),
      ...this.layout,
    };
  }

  private emit(): void {
    this.publish(this.state());
  }

  control(action: WindowControl): void {
    if (this.win.isDestroyed()) {
      return;
    }
    if (action === 'minimize') {
      this.win.minimize();
      return;
    }
    if (action === 'close') {
      this.win.close();
      return;
    }
    if (Date.now() - this.lastMaximizeChange < 400) {
      return;
    }
    if (this.win.isFullScreen()) {
      this.win.setFullScreen(false);
      return;
    }
    if (this.win.isMaximized()) {
      this.win.unmaximize();
    } else {
      this.win.maximize();
    }
  }
}
