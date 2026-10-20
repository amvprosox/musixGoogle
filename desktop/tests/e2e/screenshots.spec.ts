import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { ROOT, closeApp, launchApp, setWindowSize, viewEval, viewInfo } from './helpers';

test.skip(process.env.E2E_SCREENSHOTS !== '1', 'Set E2E_SCREENSHOTS=1 to capture documentation screenshots');

const OUT = path.resolve(ROOT, '..', 'docs', 'screenshots', 'desktop');

const SIZES: readonly [number, number, string][] = [
  [2560, 1440, 'xl-2560'],
  [1920, 1080, 'xl-1920'],
  [1440, 900, 'xl-1440'],
  [1280, 800, 'lg-1280'],
  [1024, 768, 'md-1024'],
  [768, 1024, 'sm-768'],
  [360, 640, 'xs-360'],
];

async function composite(app: ElectronApplication): Promise<Buffer> {
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
    }) as unknown as
      | {
          webContents: { capturePage(): Promise<Electron.NativeImage> };
          getBounds(): Electron.Rectangle;
          getVisible(): boolean;
        }
      | undefined;
    const shellImage = await win.webContents.capturePage();
    const content = win.getContentBounds();
    const layers: { url: string; x: number; y: number; width: number; height: number }[] = [
      { url: shellImage.toDataURL(), x: 0, y: 0, width: content.width, height: content.height },
    ];
    if (view && view.getVisible()) {
      const bounds = view.getBounds();
      const viewImage = await view.webContents.capturePage();
      layers.push({ url: viewImage.toDataURL(), ...bounds });
    }
    const helper = new BrowserWindow({ show: false, width: 64, height: 64 });
    try {
      await helper.loadURL('about:blank');
      const script = `(async () => {
        const layers = ${JSON.stringify(layers)};
        const canvas = document.createElement('canvas');
        canvas.width = ${content.width};
        canvas.height = ${content.height};
        const ctx = canvas.getContext('2d');
        for (const layer of layers) {
          const img = new Image();
          img.src = layer.url;
          await img.decode();
          ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height);
        }
        return canvas.toDataURL('image/png').split(',')[1];
      })()`;
      return (await helper.webContents.executeJavaScript(script)) as string;
    } finally {
      helper.destroy();
    }
  });
  return Buffer.from(data, 'base64');
}

async function setTheme(shell: Page, theme: 'light' | 'dark'): Promise<void> {
  if ((await shell.locator('html').getAttribute('data-theme')) !== theme) {
    await shell.locator('#theme-toggle').click();
  }
  await expect(shell.locator('html')).toHaveAttribute('data-theme', theme);
}

test('captures every breakpoint in dark and light themes', async () => {
  test.setTimeout(15 * 60 * 1000);
  mkdirSync(OUT, { recursive: true });
  const launched = await launchApp();
  try {
    const { app, shell } = launched;
    await expect.poll(async () => (await viewInfo(app))?.visible, { timeout: 60000 }).toBe(true);
    await expect
      .poll(
        () => viewEval<number>(app, `document.querySelectorAll('ytmusic-carousel-shelf-renderer').length`),
        {
          timeout: 60000,
        },
      )
      .toBeGreaterThan(0);
    await shell.waitForTimeout(3000);
    for (const theme of ['dark', 'light'] as const) {
      await setTheme(shell, theme);
      for (const [width, height, name] of SIZES) {
        await setWindowSize(app, width, height);
        await shell.waitForTimeout(1500);
        writeFileSync(path.join(OUT, `${name}-${theme}.png`), await composite(app));
      }
    }
    await setWindowSize(app, 1440, 900);
    await setTheme(shell, 'dark');
    await shell.waitForTimeout(1000);
    await viewEval(
      app,
      `(() => { const s = document.querySelector('ytmusic-carousel #items'); if (s) { s.scrollBy({ left: 400, behavior: 'instant' }); } window.scrollTo({ top: 420, behavior: 'instant' }); return true; })()`,
    );
    await shell.waitForTimeout(300);
    writeFileSync(path.join(OUT, 'scrollbars-dark.png'), await composite(app));
    await shell.locator('#sidebar [data-nav="settings"]').click();
    await shell.waitForTimeout(800);
    writeFileSync(path.join(OUT, 'settings-dark.png'), await composite(app));
  } finally {
    await closeApp(launched);
  }
});
