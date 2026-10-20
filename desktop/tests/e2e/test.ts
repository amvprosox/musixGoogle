import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test';
import { startFixtureServer, type FixtureServer } from './fixture/server';
import { closeApp, launchApp, viewEval, viewInfo, type Launched, type LaunchOptions } from './helpers';

export interface Musix extends Launched {
  server: FixtureServer;
  shellErrors: string[];
  mainErrors: string[];
  relaunch: (options?: LaunchOptions) => Promise<Musix>;
}

function watch(launched: Launched, server: FixtureServer): Musix {
  const shellErrors: string[] = [];
  const mainErrors: string[] = [];
  launched.shell.on('console', (message) => {
    if (message.type() === 'error') {
      shellErrors.push(message.text());
    }
  });
  launched.shell.on('pageerror', (error) => {
    shellErrors.push(error.message);
  });
  const stderr = launched.app.process().stderr;
  if (stderr) {
    stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (/^\[[a-z-]+\] error:/.test(line) || line.includes('Unhandled promise rejection')) {
          mainErrors.push(line);
        }
      }
    });
  }
  const musix: Musix = {
    ...launched,
    server,
    shellErrors,
    mainErrors,
    relaunch: async (options: LaunchOptions = {}) => {
      await closeApp(launched, { keepData: true });
      const next = await launchApp({ userData: launched.userData, ytmUrl: server.url, ...options });
      const watched = watch(next, server);
      await waitForView(watched.app, watched.shell, server.url);
      return watched;
    },
  };
  return musix;
}

export async function waitForView(app: ElectronApplication, shell: Page, origin: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const info = await viewInfo(app);
        return info !== null && info.visible && info.url.startsWith(origin);
      },
      { timeout: 45000 },
    )
    .toBe(true);
  await expect(shell.locator('#view-state')).toBeHidden();
}

export const test = base.extend<{ server: FixtureServer; musix: Musix }>({
  server: async ({}, use) => {
    const server = await startFixtureServer();
    await use(server);
    await server.close();
  },
  musix: async ({ server }, use) => {
    const launched = await launchApp({ ytmUrl: server.url });
    const musix = watch(launched, server);
    await waitForView(musix.app, musix.shell, server.url);
    const holder = { current: musix };
    await use(
      new Proxy(musix, {
        get(target, prop, receiver) {
          if (prop === 'relaunch') {
            return async (options?: LaunchOptions) => {
              const next = await holder.current.relaunch(options);
              holder.current = next;
              return next;
            };
          }
          return Reflect.get(target, prop, receiver) as unknown;
        },
      }),
    );
    const current = holder.current;
    expect(current.shellErrors, 'shell console errors').toEqual([]);
    expect(current.mainErrors, 'main process errors').toEqual([]);
    await closeApp(current);
  },
});

export { expect };

export async function fixture<T>(app: ElectronApplication, expression: string): Promise<T> {
  return viewEval<T>(app, `window.__fixture.${expression}`);
}

export interface FixtureStatus {
  index: number;
  paused: boolean;
  currentTime: number;
  volume: number;
  muted: boolean;
  like: string;
  shuffle: boolean;
  repeat: string;
  path: string;
}

export async function status(app: ElectronApplication): Promise<FixtureStatus> {
  return fixture<FixtureStatus>(app, 'status()');
}

export async function startPlayback(musix: Musix, index = 0): Promise<void> {
  await fixture(musix.app, `play(${index})`);
  await expect(musix.shell.locator('#player-play')).toHaveAttribute('aria-label', 'Pause');
}

export async function viewMatchesHost(musix: Musix): Promise<{
  view: { x: number; y: number; width: number; height: number } | null;
  host: { x: number; y: number; width: number; height: number };
}> {
  const info = await viewInfo(musix.app);
  const host = await musix.shell.evaluate(() => {
    const rect = document.getElementById('view-host')?.getBoundingClientRect();
    return rect
      ? {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.right) - Math.round(rect.left),
          height: Math.round(rect.bottom) - Math.round(rect.top),
        }
      : { x: -1, y: -1, width: -1, height: -1 };
  });
  return { view: info ? info.bounds : null, host };
}
