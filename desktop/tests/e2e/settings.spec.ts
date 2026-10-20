import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './test';

test('settings toggles persist across restart', async ({ musix }) => {
  const { shell } = musix;
  await shell.locator('#sidebar [data-nav="settings"]').click();
  const closeToTray = shell.locator('#setting-closeToTray');
  const notify = shell.locator('#setting-notifyOnTrackChange');
  await expect(closeToTray).toHaveAttribute('aria-checked', 'true');
  await closeToTray.click();
  await expect(closeToTray).toHaveAttribute('aria-checked', 'false');
  await notify.click();
  await expect(notify).toHaveAttribute('aria-checked', 'false');
  await shell.locator('#theme-segmented [data-value="light"]').click();
  await expect(shell.locator('html')).toHaveAttribute('data-theme', 'light');

  const next = await musix.relaunch();
  await expect(next.shell.locator('html')).toHaveAttribute('data-theme', 'light');
  await next.shell.locator('#sidebar [data-nav="settings"]').click();
  await expect(next.shell.locator('#setting-closeToTray')).toHaveAttribute('aria-checked', 'false');
  await expect(next.shell.locator('#setting-notifyOnTrackChange')).toHaveAttribute('aria-checked', 'false');
  await expect(next.shell.locator('#theme-segmented [data-value="light"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('theme toggle and system theme apply live', async ({ musix }) => {
  const { shell } = musix;
  const initial = await shell.locator('html').getAttribute('data-theme');
  await shell.locator('#theme-toggle').click();
  const expected = initial === 'dark' ? 'light' : 'dark';
  await expect(shell.locator('html')).toHaveAttribute('data-theme', expected);
  await expect(shell.locator('#theme-toggle')).toHaveAttribute(
    'aria-label',
    expected === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
  );
  const background = await shell.evaluate(
    () => getComputedStyle(document.getElementById('app') ?? document.body).backgroundColor,
  );
  expect(background).toBe(expected === 'dark' ? 'rgb(15, 20, 32)' : 'rgb(245, 246, 250)');
});

test('start on login writes and removes the autostart entry', async ({ musix }) => {
  const { shell, configHome } = musix;
  const file = path.join(configHome, 'autostart', 'musix.desktop');
  await shell.locator('#sidebar [data-nav="settings"]').click();
  const toggle = shell.locator('#setting-startOnLogin');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain('--hidden');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => existsSync(file)).toBe(false);
});

test('reset settings asks for confirmation and restores defaults', async ({ musix }) => {
  const { shell } = musix;
  await shell.locator('#sidebar [data-nav="settings"]').click();
  await shell.locator('#setting-adSkipFallback').click();
  await expect(shell.locator('#setting-adSkipFallback')).toHaveAttribute('aria-checked', 'false');
  await shell.locator('#data-reset').click();
  const dialog = shell.locator('[role="alertdialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button', { hasText: 'Cancel' })).toBeFocused();
  await dialog.locator('button', { hasText: 'Reset' }).click();
  await expect(dialog).toBeHidden();
  await expect(shell.locator('#setting-adSkipFallback')).toHaveAttribute('aria-checked', 'true');
  await expect(shell.locator('#data-reset')).toBeFocused();
});

test('actions report results with auto-dismissing toasts', async ({ musix }) => {
  const { shell, app } = musix;
  await shell.locator('#sidebar [data-nav="settings"]').click();
  await shell.locator('#data-clear-cache').click();
  await expect(shell.locator('#data-clear-cache')).toHaveAttribute('data-state', 'success');
  await expect(shell.locator('#live-region')).toHaveText(
    'Cache cleared. Cached YouTube Music files were removed.',
  );
  const toastLayer = () =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/renderer/index.html'),
      );
      const found = win?.contentView.children.find((child) => {
        const candidate = child as unknown as { webContents?: { getURL(): string } };
        return candidate.webContents?.getURL().includes('layer=toasts') ?? false;
      }) as unknown as
        | { getVisible(): boolean; getBounds(): { x: number; y: number; width: number; height: number } }
        | undefined;
      const size = win?.getContentSize() ?? [];
      const width = size[0] ?? 0;
      const height = size[1] ?? 0;
      return found ? { visible: found.getVisible(), bounds: found.getBounds(), width, height } : null;
    });
  await expect.poll(async () => (await toastLayer())?.visible).toBe(true);
  const layer = await toastLayer();
  if (layer) {
    expect(layer.bounds.x + layer.bounds.width).toBe(layer.width - 16);
    expect(layer.bounds.y + layer.bounds.height).toBeLessThan(layer.height - 88);
  }
  await expect.poll(async () => (await toastLayer())?.visible, { timeout: 7000 }).toBe(false);
});
