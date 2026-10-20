import { fixture, expect, test, viewMatchesHost } from './test';
import { viewEval, viewInfo } from './helpers';

test('launches, renders the shell, and positions the YouTube Music view inside the content area', async ({
  musix,
}) => {
  const { shell, app, server } = musix;
  await expect(shell).toHaveTitle('Musix');
  await expect(shell.locator('#sidebar .brand-name')).toHaveText('Musix');
  await expect(shell.locator('#topbar #search-input')).toBeVisible();
  await expect(shell.locator('#playerbar .full-player')).toBeVisible();
  const info = await viewInfo(app);
  expect(info?.url.startsWith(server.url)).toBe(true);
  const { view, host } = await viewMatchesHost(musix);
  expect(view).toEqual(host);
  expect(host.width).toBeGreaterThan(0);
  expect(host.height).toBeGreaterThan(0);
});

test('injects shell styling into YouTube Music and hides its own chrome', async ({ musix }) => {
  const { app } = musix;
  const hidden = await viewEval<{ bar: string; nav: string }>(
    app,
    `({ bar: getComputedStyle(document.querySelector('ytmusic-player-bar[slot="player-bar"]')).display, nav: getComputedStyle(document.querySelector('ytmusic-nav-bar')).opacity })`,
  );
  expect(hidden).toEqual({ bar: 'none', nav: '0' });
  await expect
    .poll(() =>
      viewEval<boolean>(
        app,
        `document.fonts.load('16px Manrope').then(() => document.fonts.check('16px Manrope'))`,
      ),
    )
    .toBe(true);
  const family = await viewEval<string>(app, `getComputedStyle(document.body).fontFamily`);
  expect(family).toContain('Manrope');
  const heading = await viewEval<string>(app, `getComputedStyle(document.querySelector('h1')).fontFamily`);
  expect(heading).toContain('Sora');
  const overflow = await viewEval<boolean>(
    app,
    `document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
  );
  expect(overflow).toBe(true);
});

test('shows skeletons until the view and the first player state arrive', async ({ musix }) => {
  const { app, shell } = musix;
  await expect(shell.locator('#player-skeleton')).toBeHidden();
  await expect(shell.locator('#player-track')).toBeVisible();
  await viewEval(app, `location.assign('/slow'); true`);
  await expect(shell.locator('#content-skeleton')).toBeVisible();
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(false);
  await expect(shell.locator('#content-skeleton')).toBeHidden({ timeout: 20000 });
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(true);
});

test('uses Sora for headings, Manrope elsewhere, and nothing below 14px', async ({ musix }) => {
  const { shell } = musix;
  await shell.locator('#sidebar [data-nav="settings"]').click();
  await expect(shell.locator('#settings-page')).toBeVisible();
  const report = await shell.evaluate(() => {
    const small: string[] = [];
    const wrongHeading: string[] = [];
    const wrongBody: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }
      const hasText = Array.from(el.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      );
      if (!hasText || el.closest('.sr-only')) {
        continue;
      }
      if (Number.parseFloat(style.fontSize) < 14) {
        small.push(`${el.tagName}.${el.className}: ${style.fontSize}`);
      }
      const isHeading =
        /^H[1-6]$/.test(el.tagName) ||
        el.classList.contains('track-title') ||
        el.classList.contains('stat-value') ||
        el.classList.contains('brand-name');
      if (isHeading && !style.fontFamily.startsWith('Sora')) {
        wrongHeading.push(el.tagName);
      }
      if (!isHeading && !style.fontFamily.startsWith('Manrope')) {
        wrongBody.push(`${el.tagName}.${el.className}`);
      }
    }
    return { small, wrongHeading, wrongBody };
  });
  expect(report).toEqual({ small: [], wrongHeading: [], wrongBody: [] });
  const fontsLoaded = await shell.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 16px Sora') && document.fonts.check('400 14px Manrope');
  });
  expect(fontsLoaded).toBe(true);
});

test('reflects the signed-in account avatar from YouTube Music', async ({ musix }) => {
  const { app, shell } = musix;
  await expect(shell.locator('#sign-in-button')).toBeVisible();
  await fixture(app, `signIn('https://lh3.googleusercontent.com/a/default-user=s96-c')`);
  await expect(shell.locator('#account-button')).toBeVisible({ timeout: 10000 });
  await expect(shell.locator('#account-button img')).toHaveAttribute('src', /googleusercontent/);
  await shell.locator('#account-button').click();
  await expect.poll(() => fixture<number>(app, 'menuOpened()')).toBe(1);
});

test('icon buttons show tooltips above the YouTube Music view', async ({ musix }) => {
  const { shell, app } = musix;
  const button = shell.locator('#player-next');
  await expect(button).toHaveAttribute('aria-label', 'Next');
  await expect(async () => {
    await shell.mouse.move(5, 500);
    await button.hover();
    await expect
      .poll(
        () =>
          app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows().find((w) =>
              w.webContents.getURL().endsWith('/renderer/index.html'),
            );
            const layer = win?.contentView.children.find((child) => {
              const candidate = child as unknown as { webContents?: { getURL(): string } };
              return candidate.webContents?.getURL().includes('layer=tooltip') ?? false;
            }) as unknown as { getVisible(): boolean } | undefined;
            return layer?.getVisible() ?? false;
          }),
        { timeout: 3000 },
      )
      .toBe(true);
  }).toPass({ timeout: 20000 });
  const box = await button.boundingBox();
  const layer = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    const found = win?.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return candidate.webContents?.getURL().includes('layer=tooltip') ?? false;
    }) as unknown as { getBounds(): { x: number; y: number; width: number; height: number } } | undefined;
    return found ? found.getBounds() : null;
  });
  expect(box).not.toBeNull();
  expect(layer).not.toBeNull();
  if (box && layer) {
    expect(layer.y + layer.height).toBeLessThanOrEqual(box.y);
    expect(Math.abs(layer.x + layer.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(2);
    expect(layer.height).toBeGreaterThanOrEqual(24);
  }
  await shell.mouse.move(5, 500);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith('/renderer/index.html'),
        );
        const found = win?.contentView.children.find((child) => {
          const candidate = child as unknown as { webContents?: { getURL(): string } };
          return candidate.webContents?.getURL().includes('layer=tooltip') ?? false;
        }) as unknown as { getVisible(): boolean } | undefined;
        return found?.getVisible();
      }),
    )
    .toBe(false);
});
