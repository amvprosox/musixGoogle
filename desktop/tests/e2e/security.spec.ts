import { viewEval } from './helpers';
import { expect, startPlayback, status, test } from './test';

test('main rejects commands from the wrong sender and malformed payloads', async ({ musix }) => {
  const { app, shell } = musix;
  await startPlayback(musix, 0);
  const stderr: string[] = [];
  app.process().stderr?.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString('utf8'));
  });
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    const view = win?.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return candidate.webContents !== undefined && !candidate.webContents.getURL().includes('overlay.html');
    }) as unknown as { webContents: Electron.WebContents } | undefined;
    if (!view) {
      throw new Error('view missing');
    }
    ipcMain.emit(
      'view:command',
      { sender: view.webContents, senderFrame: view.webContents.mainFrame },
      { type: 'next' },
    );
  });
  await shell.evaluate(() => {
    const api = window.musix as unknown as { send: (channel: string, payload: unknown) => void } | undefined;
    api?.send('view:command', { type: 'eval', code: 'alert(1)' });
    api?.send('view:command', { type: 'seekTo', seconds: -50 });
    api?.send('view:layout', { bounds: { x: 0, y: 0, width: Number.NaN, height: 10 }, visible: true });
    api?.send('not:a-channel', null);
  });
  await expect
    .poll(() => stderr.join('').match(/Rejected message on view:command/g)?.length ?? 0)
    .toBeGreaterThanOrEqual(3);
  await expect.poll(() => stderr.join('').includes('Rejected message on view:layout')).toBe(true);
  expect((await status(app)).index).toBe(0);
  await expect.poll(async () => (await status(app)).currentTime).toBeGreaterThan(0);
});

test('renderers have no Node or Electron access', async ({ musix }) => {
  const { app, shell } = musix;
  const shellScope = await shell.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process,
    keys: Object.keys(window.musix ?? {}).sort(),
  }));
  expect(shellScope).toEqual({
    require: 'undefined',
    process: 'undefined',
    keys: ['boot', 'invoke', 'on', 'send'],
  });
  const viewScope = await viewEval<{ require: string; process: string; ipc: string }>(
    app,
    `({ require: typeof require, process: typeof process, ipc: typeof window.ipcRenderer })`,
  );
  expect(viewScope).toEqual({ require: 'undefined', process: 'undefined', ipc: 'undefined' });
});
