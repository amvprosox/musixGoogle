import { spawn } from 'node:child_process';
import path from 'node:path';
import { ELECTRON_BIN, launchArgs, launchEnv } from './helpers';
import { expect, test } from './test';

test('a second launch focuses the existing window and exits', async ({ musix }) => {
  const { app, userData, server } = musix;
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    win?.hide();
  });
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('/renderer/index.html'))
          ?.isVisible(),
      ),
    )
    .toBe(false);
  const child = spawn(ELECTRON_BIN, launchArgs(), {
    env: launchEnv(userData, path.join(userData, 'xdg-config'), server.url),
    stdio: 'ignore',
  });
  const code = await new Promise<number | null>((resolve) => {
    child.on('exit', (exitCode) => {
      resolve(exitCode);
    });
  });
  expect(code).toBe(0);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('/renderer/index.html'))
          ?.isVisible(),
      ),
    )
    .toBe(true);
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  expect(windows).toBe(1);
});

test('closing the window hides it to the tray and the app keeps running', async ({ musix }) => {
  const { app } = musix;
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/renderer/index.html'))
      ?.close();
  });
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith('/renderer/index.html'),
        );
        return win ? { destroyed: win.isDestroyed(), visible: win.isVisible() } : null;
      }),
    )
    .toEqual({ destroyed: false, visible: false });
});
