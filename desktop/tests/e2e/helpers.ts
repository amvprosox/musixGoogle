import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const ROOT = process.env.MUSIX_ROOT ?? process.cwd();
export const ELECTRON_BIN = require('electron') as unknown as string;
const CACHE_DIR = path.join(ROOT, 'tests', '.cache');
const ENGINE_CACHE = path.join(CACHE_DIR, 'adblock-engine.bin');

function usernsRestricted(): boolean {
  try {
    return readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1';
  } catch {
    return false;
  }
}

export function sandboxArgs(): string[] {
  const sandbox = path.join(path.dirname(ELECTRON_BIN), 'chrome-sandbox');
  let suid = false;
  if (existsSync(sandbox)) {
    const stats = statSync(sandbox);
    suid = stats.uid === 0 && (stats.mode & 0o4000) !== 0;
  }
  return !suid && usernsRestricted() ? ['--no-sandbox'] : [];
}

export interface LaunchOptions {
  userData?: string;
  ytmUrl?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
}

export interface Launched {
  app: ElectronApplication;
  shell: Page;
  userData: string;
  configHome: string;
}

const ownedDirs = new Set<string>();

export function makeUserData(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'musix-e2e-'));
  ownedDirs.add(dir);
  if (existsSync(ENGINE_CACHE)) {
    copyFileSync(ENGINE_CACHE, path.join(dir, 'adblock-engine.bin'));
  }
  return dir;
}

export function saveEngineCache(userData: string): void {
  const file = path.join(userData, 'adblock-engine.bin');
  if (!existsSync(file) || existsSync(ENGINE_CACHE)) {
    return;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  copyFileSync(file, ENGINE_CACHE);
}

const VIRTUAL_DISPLAY = process.env.E2E_DISPLAY ?? '';

export function launchArgs(extra: string[] = []): string[] {
  const display = VIRTUAL_DISPLAY === '' ? [] : ['--ozone-platform=x11'];
  return [...sandboxArgs(), ...display, ...extra, ROOT];
}

export function launchEnv(
  userData: string,
  configHome: string,
  ytmUrl: string | undefined,
  env: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      base[key] = value;
    }
  }
  if (VIRTUAL_DISPLAY !== '') {
    base.DISPLAY = VIRTUAL_DISPLAY;
    delete base.WAYLAND_DISPLAY;
    base.XDG_SESSION_TYPE = 'x11';
  }
  return {
    ...base,
    MUSIX_USER_DATA: userData,
    MUSIX_E2E: '1',
    XDG_CONFIG_HOME: configHome,
    ...(ytmUrl ? { MUSIX_YTM_URL: ytmUrl } : {}),
    ...env,
  };
}

export async function launchApp(options: LaunchOptions = {}): Promise<Launched> {
  const userData = options.userData ?? makeUserData();
  const configHome = path.join(userData, 'xdg-config');
  mkdirSync(configHome, { recursive: true });
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: launchArgs(options.extraArgs),
    env: launchEnv(userData, configHome, options.ytmUrl, options.env),
    timeout: 60000,
  });
  const shell = await findShell(app);
  await shell.waitForSelector('#app[data-ready="true"]', { timeout: 30000 });
  return { app, shell, userData, configHome };
}

export async function findShell(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      if (page.url().endsWith('/renderer/index.html')) {
        return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Shell window not found');
}

async function quietly(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (process.env.E2E_DEBUG === '1') {
      console.warn(error);
    }
  }
}

export function removeUserData(dir: string): void {
  if (!ownedDirs.has(dir)) {
    return;
  }
  ownedDirs.delete(dir);
  rmSync(dir, { recursive: true, force: true });
}

export async function closeApp(launched: Launched, options: { keepData?: boolean } = {}): Promise<void> {
  await quietly(() =>
    launched.app.evaluate(({ app }) => {
      app.quit();
    }),
  );
  await quietly(() => launched.app.close());
  saveEngineCache(launched.userData);
  if (options.keepData !== true) {
    removeUserData(launched.userData);
  }
}

export interface ViewInfo {
  url: string;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export async function viewInfo(app: ElectronApplication): Promise<ViewInfo | null> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    if (!win) {
      return null;
    }
    const view = win.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return (
        candidate.webContents !== undefined &&
        !candidate.webContents.getURL().includes('/renderer/overlay.html')
      );
    }) as unknown as
      | {
          webContents: { getURL(): string };
          getBounds(): { x: number; y: number; width: number; height: number };
          getVisible(): boolean;
        }
      | undefined;
    if (!view) {
      return null;
    }
    return { url: view.webContents.getURL(), bounds: view.getBounds(), visible: view.getVisible() };
  });
}

export async function viewEval<T>(app: ElectronApplication, source: string): Promise<T> {
  return app.evaluate(async ({ BrowserWindow }, code) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    if (!win) {
      throw new Error('no window');
    }
    const view = win.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return (
        candidate.webContents !== undefined &&
        !candidate.webContents.getURL().includes('/renderer/overlay.html')
      );
    }) as unknown as { webContents: { executeJavaScript(code: string): Promise<unknown> } } | undefined;
    if (!view) {
      throw new Error('no view');
    }
    return view.webContents.executeJavaScript(code);
  }, source) as Promise<T>;
}

export async function viewScreenshot(app: ElectronApplication, file: string): Promise<void> {
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    if (!win) {
      return '';
    }
    const view = win.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return (
        candidate.webContents !== undefined &&
        !candidate.webContents.getURL().includes('/renderer/overlay.html')
      );
    }) as unknown as { webContents: { capturePage(): Promise<{ toPNG(): Buffer }> } } | undefined;
    if (!view) {
      return '';
    }
    const image = await view.webContents.capturePage();
    return image.toPNG().toString('base64');
  });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, Buffer.from(data, 'base64'));
}

export async function setWindowSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/renderer/index.html'),
      );
      if (!win) {
        return;
      }
      if (win.isMaximized()) {
        win.unmaximize();
      }
      win.setContentSize(size.width, size.height);
    },
    { width, height },
  );
}
