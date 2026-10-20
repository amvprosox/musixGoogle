import { closeApp, launchApp, setWindowSize, viewInfo } from './helpers';
import { expect, startPlayback, test, viewMatchesHost, waitForView } from './test';

const SIZES: [number, number, string, string][] = [
  [2560, 1440, 'xl', 'expanded'],
  [1920, 1080, 'xl', 'expanded'],
  [1440, 900, 'xl', 'expanded'],
  [1280, 800, 'lg', 'expanded'],
  [1024, 768, 'md', 'rail'],
  [768, 1024, 'sm', 'drawer'],
  [360, 640, 'xs', 'bottom-nav'],
];

test('every breakpoint lays out without horizontal scroll and keeps the view aligned', async ({ musix }) => {
  const { shell, app } = musix;
  for (const [width, height, bp, sidebar] of SIZES) {
    await setWindowSize(app, width, height);
    await expect(shell.locator('#app')).toHaveAttribute('data-bp', bp);
    await expect(shell.locator('#app')).toHaveAttribute('data-sidebar', sidebar);
    const overflow = await shell.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${width}x${height}`).toBeLessThanOrEqual(0);
    const collisions = () =>
      shell.evaluate(() => {
        const bar = document.querySelector('.topbar-inner');
        if (!bar) {
          return ['missing top bar'];
        }
        const limit = bar.getBoundingClientRect();
        const parts = Array.from(
          bar.querySelectorAll(
            '.topbar-brand > *, .topbar-group > *, .search-form, .window-controls button, #theme-toggle',
          ),
        )
          .map((el) => ({ el, rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width > 0 && rect.height > 0);
        const issues: string[] = [];
        for (const [i, a] of parts.entries()) {
          if (a.rect.left < limit.left - 0.5 || a.rect.right > limit.right + 0.5) {
            issues.push(`${a.el.id || a.el.className} leaves the bar`);
          }
          for (const b of parts.slice(i + 1)) {
            if (a.el.contains(b.el) || b.el.contains(a.el)) {
              continue;
            }
            const overlapX = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
            const overlapY = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
            if (overlapX > 0.5 && overlapY > 0.5) {
              issues.push(`${a.el.id || a.el.className} overlaps ${b.el.id || b.el.className}`);
            }
          }
        }
        return issues;
      });
    await expect.poll(collisions, { message: `${width}x${height}` }).toEqual([]);
    await expect
      .poll(
        async () => {
          const { view, host } = await viewMatchesHost(musix);
          return JSON.stringify(view) === JSON.stringify(host);
        },
        { message: `${width}x${height}` },
      )
      .toBe(true);
    const grid = await shell.evaluate(() =>
      getComputedStyle(document.getElementById('app') ?? document.body)
        .getPropertyValue('--grid-cols')
        .trim(),
    );
    expect(grid).toBe({ xl: '4', lg: '3', md: '2', sm: '2', xs: '1' }[bp]);
  }
});

test('collapsing the sidebar resizes the view without gaps', async ({ musix }) => {
  const { shell } = musix;
  const frameInset = await shell.evaluate(() =>
    Math.round(
      parseFloat(getComputedStyle(document.getElementById('app') ?? document.body).borderLeftWidth) || 0,
    ),
  );
  await shell.locator('#sidebar-collapse').click();
  await expect(shell.locator('#app')).toHaveAttribute('data-sidebar', 'rail');
  await expect.poll(async () => (await viewMatchesHost(musix)).view?.x).toBe(72 + frameInset);
  const { view, host } = await viewMatchesHost(musix);
  expect(view).toEqual(host);
  await shell.locator('#sidebar-collapse').click();
  await expect.poll(async () => (await viewMatchesHost(musix)).view?.x).toBe(240 + frameInset);
});

test('small screens use a navigation drawer that traps focus', async ({ musix }) => {
  const { shell, app } = musix;
  await setWindowSize(app, 800, 900);
  await expect(shell.locator('#app')).toHaveAttribute('data-bp', 'sm');
  const hamburger = shell.locator('#hamburger');
  await hamburger.click();
  await expect(shell.locator('#app')).toHaveAttribute('data-sidebar-open', 'true');
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(false);
  await expect(shell.locator('#sidebar [data-nav="home"]')).toBeFocused();
  for (let i = 0; i < 12; i += 1) {
    await shell.keyboard.press('Tab');
    const inside = await shell.evaluate(
      () => document.getElementById('sidebar')?.contains(document.activeElement) ?? false,
    );
    expect(inside).toBe(true);
  }
  await shell.locator('#backdrop').click({ position: { x: 700, y: 400 } });
  await expect(shell.locator('#app')).toHaveAttribute('data-sidebar-open', 'false');
  await expect(hamburger).toBeFocused();
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(true);

  await shell.locator('#player-volume-popover').click();
  await expect(shell.locator('#volume-popover')).toBeVisible();
  await shell.keyboard.press('Escape');
  await expect(shell.locator('#volume-popover')).toBeHidden();
});

test('extra small screens use bottom navigation, a compact player, and sheets', async ({ musix }) => {
  const { shell, app } = musix;
  await startPlayback(musix, 2);
  await setWindowSize(app, 360, 640);
  await expect(shell.locator('#bottom-nav')).toBeVisible();
  await expect(shell.locator('.compact-player')).toBeVisible();
  await expect(shell.locator('.full-player')).toBeHidden();
  const title = shell.locator('#compact-title');
  await expect(title).toHaveText('Paper Planes Over Lisbon In The Late Afternoon Light');
  const truncated = await title.evaluate(
    (el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis',
  );
  expect(truncated).toBe(true);

  await shell.locator('#compact-open').click();
  await expect(shell.locator('#nowplaying')).toHaveAttribute('data-open', 'true');
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(false);
  await expect(shell.locator('#np-close')).toBeFocused();
  await expect(shell.locator('#np-play')).toHaveAttribute('aria-label', 'Pause');
  await shell.keyboard.press('Escape');
  await expect(shell.locator('#nowplaying')).toHaveAttribute('data-open', 'false');
  await expect(shell.locator('#compact-open')).toBeFocused();

  await shell.locator('#bottom-nav [data-nav="search"]').click();
  await expect(shell.locator('#search-overlay')).toBeVisible();
  await expect(shell.locator('#search-overlay-input')).toBeFocused();
  await shell.locator('#search-overlay-input').fill('quiet');
  await shell.locator('#search-overlay-input').press('Enter');
  await expect(shell.locator('#search-overlay')).toBeHidden();
  await expect.poll(async () => (await viewInfo(app))?.url).toContain('/search?q=quiet');
  await expect(shell.locator('#bottom-nav [data-nav="search"]')).toHaveAttribute('aria-current', 'page');
  const overflow = await shell.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

for (const scale of [1.25, 1.5]) {
  test(`view bounds match the content area at ${scale * 100} percent scaling`, async ({ server }) => {
    const launched = await launchApp({
      ytmUrl: server.url,
      extraArgs: [`--force-device-scale-factor=${scale}`],
    });
    try {
      await waitForView(launched.app, launched.shell, server.url);
      for (const [width, height] of [
        [1280, 800],
        [1024, 768],
        [768, 1024],
      ] as const) {
        await setWindowSize(launched.app, width, height);
        await launched.shell.waitForTimeout(400);
        const ratio = await launched.shell.evaluate(() => window.devicePixelRatio);
        expect(ratio).toBeCloseTo(scale, 2);
        const host = await launched.shell.evaluate(() => {
          const r = document.getElementById('view-host')?.getBoundingClientRect();
          return r
            ? {
                x: Math.round(r.left),
                y: Math.round(r.top),
                width: Math.round(r.right) - Math.round(r.left),
                height: Math.round(r.bottom) - Math.round(r.top),
              }
            : null;
        });
        await expect
          .poll(async () => JSON.stringify((await viewInfo(launched.app))?.bounds))
          .toBe(JSON.stringify(host));
        const overflow = await launched.shell.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      }
    } finally {
      await closeApp(launched);
    }
  });
}
