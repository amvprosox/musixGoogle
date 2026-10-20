import type { ElectronApplication } from '@playwright/test';
import { expect, startPlayback, status, test } from './test';

async function sendKeyToView(
  app: ElectronApplication,
  keyCode: string,
  modifiers: ('control' | 'shift')[] = [],
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, input) => {
      const win = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith('/renderer/index.html'),
      );
      const view = win?.contentView.children.find((child) => {
        const candidate = child as unknown as { webContents?: { getURL(): string } };
        return (
          candidate.webContents !== undefined && !candidate.webContents.getURL().includes('overlay.html')
        );
      }) as unknown as { webContents: Electron.WebContents } | undefined;
      if (!view) {
        return;
      }
      view.webContents.focus();
      view.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: input.keyCode,
        modifiers: input.modifiers,
      });
      if (input.keyCode.length === 1) {
        view.webContents.sendInputEvent({ type: 'char', keyCode: input.keyCode, modifiers: input.modifiers });
      }
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode: input.keyCode, modifiers: input.modifiers });
    },
    { keyCode, modifiers },
  );
}

test('keyboard shortcuts control playback from the shell', async ({ musix }) => {
  const { shell, app } = musix;
  await startPlayback(musix, 0);
  await shell.locator('body').click({ position: { x: 600, y: 30 } });
  await shell.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });

  await shell.keyboard.press('Space');
  await expect.poll(async () => (await status(app)).paused).toBe(true);
  await shell.keyboard.press('Space');
  await expect.poll(async () => (await status(app)).paused).toBe(false);

  await shell.keyboard.press('Control+ArrowRight');
  await expect.poll(async () => (await status(app)).index).toBe(1);
  await shell.keyboard.press('Control+ArrowLeft');
  await expect.poll(async () => (await status(app)).index).toBe(0);

  const start = (await status(app)).currentTime;
  await shell.keyboard.press('ArrowRight');
  await expect.poll(async () => (await status(app)).currentTime).toBeGreaterThanOrEqual(start + 9);
  const afterForward = (await status(app)).currentTime;
  await shell.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await status(app)).currentTime).toBeLessThan(afterForward - 5);

  await shell.keyboard.press('ArrowDown');
  await expect.poll(async () => (await status(app)).volume).toBe(95);
  await shell.keyboard.press('ArrowUp');
  await expect.poll(async () => (await status(app)).volume).toBe(100);

  await shell.keyboard.press('m');
  await expect.poll(async () => (await status(app)).muted).toBe(true);
  await shell.keyboard.press('m');
  await expect.poll(async () => (await status(app)).muted).toBe(false);
  await shell.keyboard.press('l');
  await expect.poll(async () => (await status(app)).like).toBe('LIKE');
  await shell.keyboard.press('s');
  await expect.poll(async () => (await status(app)).shuffle).toBe(true);
  await shell.keyboard.press('r');
  await expect.poll(async () => (await status(app)).repeat).toBe('ALL');

  await shell.keyboard.press('Control+k');
  await expect(shell.locator('#search-input')).toBeFocused();
  await shell.keyboard.press('Escape');
  await expect(shell.locator('#search-input')).not.toBeFocused();
  await shell.keyboard.press('/');
  await expect(shell.locator('#search-input')).toBeFocused();
  await shell.keyboard.press('Escape');

  await shell.keyboard.press('Control+,');
  await expect(shell.locator('#settings-page')).toBeVisible();
  await shell.keyboard.press('Escape');
  await expect(shell.locator('#settings-page')).toBeHidden();
});

test('shortcuts are ignored while typing', async ({ musix }) => {
  const { shell, app } = musix;
  await startPlayback(musix, 0);
  const before = await status(app);
  const input = shell.locator('#search-input');
  await input.click();
  await shell.keyboard.type('mls r');
  await shell.keyboard.press('ArrowLeft');
  await shell.keyboard.press('ArrowDown');
  await expect(input).toHaveValue('mls r');
  await shell.waitForTimeout(800);
  const after = await status(app);
  expect(after.muted).toBe(before.muted);
  expect(after.like).toBe(before.like);
  expect(after.shuffle).toBe(before.shuffle);
  expect(after.repeat).toBe(before.repeat);
  expect(after.volume).toBe(before.volume);
  expect(after.paused).toBe(false);
});

test('shortcuts work while YouTube Music has focus', async ({ musix }) => {
  const { app } = musix;
  await startPlayback(musix, 0);
  await sendKeyToView(app, 'Space');
  await expect.poll(async () => (await status(app)).paused).toBe(true);
  await sendKeyToView(app, 'Space');
  await expect.poll(async () => (await status(app)).paused).toBe(false);
  await sendKeyToView(app, 'Right', ['control']);
  await expect.poll(async () => (await status(app)).index).toBe(1);
  await sendKeyToView(app, 'm');
  await expect.poll(async () => (await status(app)).muted).toBe(true);
});
