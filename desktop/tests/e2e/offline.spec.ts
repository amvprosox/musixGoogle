import { viewInfo } from './helpers';
import { expect, test } from './test';

test('offline mode shows the offline screen and recovers on reconnect', async ({ musix }) => {
  const { shell, app } = musix;
  const cdp = await shell.context().newCDPSession(shell);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await expect(shell.locator('#offline-screen')).toBeVisible();
  await expect(shell.locator('#offline-screen h2')).toHaveText('You are offline');
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(false);
  await shell.locator('#offline-screen-retry').click();
  await expect(shell.locator('#offline-screen')).toBeVisible();
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await expect(shell.locator('#offline-screen')).toBeHidden();
  await expect.poll(async () => (await viewInfo(app))?.visible, { timeout: 30000 }).toBe(true);
  await cdp.detach();
});

test('a failed load shows an error state with retry', async ({ musix }) => {
  const { shell, app } = musix;
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    const view = win?.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return candidate.webContents !== undefined && !candidate.webContents.getURL().includes('overlay.html');
    }) as unknown as { webContents: { loadURL(url: string): Promise<void> } } | undefined;
    view?.webContents.loadURL('http://127.0.0.1:1/unreachable').catch(() => undefined);
  });
  await expect(shell.locator('#error-screen')).toBeVisible({ timeout: 20000 });
  await shell.locator('#error-screen-retry').click();
  await expect(shell.locator('#error-screen')).toBeHidden({ timeout: 20000 });
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(true);
});

test('a crashed YouTube Music renderer recovers and restores the last URL', async ({ musix }) => {
  const { shell, app } = musix;
  await shell.locator('#sidebar [data-nav="explore"]').click();
  await expect.poll(async () => (await viewInfo(app))?.url).toContain('/explore');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    const view = win?.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return candidate.webContents !== undefined && !candidate.webContents.getURL().includes('overlay.html');
    }) as unknown as { webContents: { forcefullyCrashRenderer(): void } } | undefined;
    view?.webContents.forcefullyCrashRenderer();
  });
  await expect(shell.locator('#recovering-screen')).toBeVisible();
  await expect(shell.locator('#recovering-screen')).toBeHidden({ timeout: 30000 });
  await expect.poll(async () => (await viewInfo(app))?.url).toContain('/explore');
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(true);
});
