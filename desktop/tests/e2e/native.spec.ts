import type { ElectronApplication, Page } from '@playwright/test';
import { setWindowSize, viewEval, viewInfo } from './helpers';
import { expect, fixture, startPlayback, status, test } from './test';

type Layer = 'tooltip' | 'toasts' | 'menu';

async function layerState(
  app: ElectronApplication,
  layer: Layer,
): Promise<{ visible: boolean; bounds: { x: number; y: number; width: number; height: number } } | null> {
  return app.evaluate(({ BrowserWindow }, name) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    const view = win?.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return candidate.webContents?.getURL().includes(`layer=${name}`) ?? false;
    }) as unknown as
      | { getVisible(): boolean; getBounds(): { x: number; y: number; width: number; height: number } }
      | undefined;
    return view ? { visible: view.getVisible(), bounds: view.getBounds() } : null;
  }, layer);
}

async function menuKeys(app: ElectronApplication, keys: string[]): Promise<void> {
  await expect
    .poll(() =>
      app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith('/renderer/index.html'),
        );
        const view = win?.contentView.children.find((child) => {
          const candidate = child as unknown as { webContents?: { getURL(): string } };
          return candidate.webContents?.getURL().includes('layer=menu') ?? false;
        }) as unknown as { webContents: Electron.WebContents } | undefined;
        if (!view) {
          return false;
        }
        return (await view.webContents.executeJavaScript(
          `document.activeElement?.classList.contains('menu-item') === true`,
        )) as boolean;
      }),
    )
    .toBe(true);
  await app.evaluate(({ BrowserWindow }, sequence) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    const view = win?.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return candidate.webContents?.getURL().includes('layer=menu') ?? false;
    }) as unknown as { webContents: Electron.WebContents } | undefined;
    if (!view) {
      return;
    }
    for (const keyCode of sequence) {
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    }
  }, keys);
}

async function menuLabels(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    const view = win?.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return candidate.webContents?.getURL().includes('layer=menu') ?? false;
    }) as unknown as { webContents: Electron.WebContents } | undefined;
    if (!view) {
      return [];
    }
    return (await view.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('.menu-item')).map((b) => b.textContent.trim() + (b.disabled ? ' (disabled)' : ''))`,
    )) as string[];
  });
}

async function viewMouse(
  app: ElectronApplication,
  selector: string,
  button: 'left' | 'right' | 'middle',
  modifiers: string[] = [],
): Promise<void> {
  const rect = await viewEval<{ x: number; y: number } | null>(
    app,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
  );
  if (!rect) {
    throw new Error(`No element ${selector}`);
  }
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
      const modifiers = input.modifiers as ('control' | 'shift')[];
      view.webContents.sendInputEvent({ type: 'mouseMove', x: input.x, y: input.y, modifiers });
      view.webContents.sendInputEvent({
        type: 'mouseDown',
        x: input.x,
        y: input.y,
        button: input.button as 'left',
        clickCount: 1,
        modifiers,
      });
      view.webContents.sendInputEvent({
        type: 'mouseUp',
        x: input.x,
        y: input.y,
        button: input.button as 'left',
        clickCount: 1,
        modifiers,
      });
    },
    { ...rect, button, modifiers },
  );
}

async function scrollbarStyle(
  page: Page,
  selector: string,
): Promise<{ width: string; standard: string; button: string }> {
  return page.evaluate((sel) => {
    const el = sel === 'html' ? document.documentElement : document.querySelector(sel);
    if (!el) {
      return { width: 'missing', standard: 'missing', button: 'missing' };
    }
    return {
      width: getComputedStyle(el, '::-webkit-scrollbar').width,
      standard: getComputedStyle(el).getPropertyValue('scrollbar-width'),
      button: getComputedStyle(el, '::-webkit-scrollbar-button').display,
    };
  }, selector);
}

test('no native scrollbars remain in the shell or YouTube Music at any breakpoint or theme', async ({
  musix,
}) => {
  const { shell, app } = musix;
  await shell.locator('#sidebar [data-nav="settings"]').click();
  for (const theme of ['dark', 'light'] as const) {
    await shell.locator(`#theme-segmented [data-value="${theme}"]`).click();
    await expect(shell.locator('html')).toHaveAttribute('data-theme', theme);
    for (const [width, height] of [
      [1920, 1080],
      [1280, 800],
      [1024, 768],
      [768, 1024],
      [360, 640],
    ] as const) {
      await setWindowSize(app, width, height);
      for (const selector of ['#settings-page', '#queue-panel .panel-body', '#view-state', 'html']) {
        const style = await scrollbarStyle(shell, selector);
        expect(style, `${theme} ${width} ${selector}`).toEqual({
          width: '10px',
          standard: 'auto',
          button: 'none',
        });
      }
      const thumb = await shell.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-thumb').trim(),
      );
      expect(thumb).toMatch(/^#[0-9a-f]{6}$/);
    }
  }
  const ytm = await viewEval<{ root: string; standard: string; carousel: string; carouselStandard: string }>(
    app,
    `(() => ({
      root: getComputedStyle(document.documentElement, '::-webkit-scrollbar').width,
      standard: getComputedStyle(document.documentElement).scrollbarWidth,
      carousel: getComputedStyle(document.querySelector('#fixture-carousel #items'), '::-webkit-scrollbar').display,
      carouselStandard: getComputedStyle(document.querySelector('#fixture-carousel #items')).scrollbarWidth,
    }))()`,
  );
  expect(ytm).toEqual({ root: '10px', standard: 'auto', carousel: 'none', carouselStandard: 'none' });
});

test('scrollbars auto-hide and scroll areas fade at their edges', async ({ musix }) => {
  const { shell, app } = musix;
  await setWindowSize(app, 1280, 700);
  await shell.locator('#sidebar [data-nav="settings"]').click();
  const page = shell.locator('#settings-page');
  await expect(page).toHaveAttribute('data-fade-top', 'false');
  await expect(page).toHaveAttribute('data-fade-bottom', 'true');
  const mask = await page.evaluate((el) => getComputedStyle(el).maskImage);
  expect(mask).toContain('linear-gradient');
  await page.evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect(page).toHaveClass(/is-scrolling/);
  await expect(page).toHaveAttribute('data-fade-top', 'true');
  await expect(page).not.toHaveClass(/is-scrolling/, { timeout: 3000 });
  await page.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page).toHaveAttribute('data-fade-bottom', 'false');
  await shell.mouse.move(5, 5);
  await expect
    .poll(() => page.evaluate((el) => getComputedStyle(el).getPropertyValue('--sb-thumb').trim()), {
      timeout: 3000,
    })
    .toBe('rgba(0, 0, 0, 0)');
  await page.hover();
  await expect
    .poll(() => page.evaluate((el) => getComputedStyle(el).getPropertyValue('--sb-thumb').trim()))
    .not.toBe('rgba(0, 0, 0, 0)');
  expect(await page.evaluate((el) => getComputedStyle(el).overscrollBehaviorY)).toBe('contain');
  expect(await page.evaluate((el) => getComputedStyle(el).scrollbarGutter)).toBe('stable');

  await viewEval(app, `window.scrollTo(0, 400); true`);
  await expect
    .poll(() => viewEval<boolean>(app, `document.documentElement.classList.contains('musix-scrolling')`))
    .toBe(true);
  await expect
    .poll(() => viewEval<boolean>(app, `document.documentElement.classList.contains('musix-scrolling')`), {
      timeout: 3000,
    })
    .toBe(false);
});

async function viewInput(app: ElectronApplication, events: Electron.InputEvent[]): Promise<void> {
  await app.evaluate(
    async ({ BrowserWindow }, list) => {
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
        throw new Error('view missing');
      }
      for (const event of list) {
        view.webContents.sendInputEvent(event as unknown as Electron.MouseInputEvent);
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    },
    events as unknown as Record<string, unknown>[],
  );
}

async function carouselPoint(app: ElectronApplication): Promise<{ x: number; y: number }> {
  return viewEval<{ x: number; y: number }>(
    app,
    `(() => { window.scrollTo(0, 0); const r = document.querySelector('#fixture-carousel #items').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
  );
}

test('the mouse wheel scrolls the page while the pointer is over a shelf of cards', async ({ musix }) => {
  const { app } = musix;
  await setWindowSize(app, 1280, 800);
  const point = await carouselPoint(app);
  await viewInput(app, [
    { type: 'mouseMove', x: point.x, y: point.y } as Electron.MouseInputEvent,
    {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY: -240,
      canScroll: true,
    } as Electron.MouseWheelInputEvent,
    {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY: -240,
      canScroll: true,
    } as Electron.MouseWheelInputEvent,
  ]);
  await expect.poll(() => viewEval<number>(app, 'window.scrollY')).toBeGreaterThan(100);
});

test('shelves scroll by click and drag without opening the card under the pointer', async ({ musix }) => {
  const { app } = musix;
  await setWindowSize(app, 1280, 800);
  await viewEval(
    app,
    `(() => { window.__cardClicks = 0; document.querySelectorAll('#fixture-carousel #items li').forEach((li) => li.addEventListener('click', () => { window.__cardClicks += 1; })); document.querySelector('#fixture-carousel #items').scrollLeft = 0; return true; })()`,
  );
  const point = await carouselPoint(app);
  const moves = Array.from({ length: 12 }, (_, i) => ({
    type: 'mouseMove',
    x: point.x - (i + 1) * 25,
    y: point.y,
    button: 'left',
    modifiers: ['leftButtonDown'],
  }));
  await viewInput(app, [
    { type: 'mouseMove', x: point.x, y: point.y } as Electron.MouseInputEvent,
    { type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 } as Electron.MouseInputEvent,
    ...(moves as Electron.MouseInputEvent[]),
    {
      type: 'mouseUp',
      x: point.x - 300,
      y: point.y,
      button: 'left',
      clickCount: 1,
    } as Electron.MouseInputEvent,
  ]);
  await expect
    .poll(() => viewEval<number>(app, `document.querySelector('#fixture-carousel #items').scrollLeft`))
    .toBeGreaterThan(200);
  expect(await viewEval<number>(app, 'window.__cardClicks')).toBe(0);
  await viewInput(app, [
    { type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 } as Electron.MouseInputEvent,
    { type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 } as Electron.MouseInputEvent,
  ]);
  await expect.poll(() => viewEval<number>(app, 'window.__cardClicks')).toBe(1);
});

test('horizontal shelves scroll page by page with chevrons', async ({ musix }) => {
  const { app } = musix;
  await setWindowSize(app, 1280, 800);
  const read = () =>
    viewEval<{ prev: boolean | null; next: boolean | null; left: number; opacity: string }>(
      app,
      `(() => { const host = document.querySelector('#fixture-carousel'); const s = host.querySelector('#items'); const p = host.querySelector('.musix-shelf-btn[data-dir="prev"]'); const n = host.querySelector('.musix-shelf-btn[data-dir="next"]'); return { prev: p ? p.disabled : null, next: n ? n.disabled : null, left: s.scrollLeft, opacity: n ? getComputedStyle(n).opacity : '' }; })()`,
    );
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    const view = win?.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: Electron.WebContents };
      return (
        candidate.webContents !== undefined &&
        !candidate.webContents.getURL().includes('/renderer/overlay.html')
      );
    }) as unknown as { webContents: Electron.WebContents } | undefined;
    view?.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
  });
  await expect.poll(async () => (await read()).prev).toBe(true);
  expect((await read()).next).toBe(false);
  await expect.poll(async () => (await read()).opacity).toBe('0');
  await viewEval(
    app,
    `document.querySelector('#fixture-carousel .musix-shelf-btn[data-dir="next"]').click(); true`,
  );
  await expect.poll(async () => (await read()).left).toBeGreaterThan(100);
  await expect.poll(async () => (await read()).prev).toBe(false);
  await viewEval(
    app,
    `(() => { const s = document.querySelector('#fixture-carousel #items'); s.scrollLeft = s.scrollWidth; return true; })()`,
  );
  await expect.poll(async () => (await read()).next).toBe(true);
});

test('queue rows open a custom context menu that drives YouTube Music', async ({ musix }) => {
  const { shell, app } = musix;
  await startPlayback(musix, 0);
  await shell.locator('#queue-table tbody tr').nth(2).click({ button: 'right' });
  await expect.poll(async () => (await layerState(app, 'menu'))?.visible).toBe(true);
  expect(await menuLabels(app)).toEqual([
    'Play next',
    'Add to queue',
    'Like (disabled)',
    'Go to artist',
    'Go to album',
    'Copy link',
  ]);
  await menuKeys(app, ['Return']);
  await expect
    .poll(async () => (await fixture<string[]>(app, 'commands()')).join('\n'))
    .toContain('INSERT_AFTER_CURRENT_VIDEO');
  expect((await fixture<string[]>(app, 'commands()')).join('\n')).toContain('trk0000003c');
  await expect.poll(async () => (await layerState(app, 'menu'))?.visible).toBe(false);

  await shell.locator('#queue-table tbody tr').nth(1).click({ button: 'right' });
  await expect.poll(async () => (await layerState(app, 'menu'))?.visible).toBe(true);
  await menuKeys(app, ['Escape']);
  await expect.poll(async () => (await layerState(app, 'menu'))?.visible).toBe(false);
});

test('YouTube Music items open the same menu with like, navigation, and copy link', async ({ musix }) => {
  const { app } = musix;
  await viewMouse(app, '.fixture-item[data-row="0"] .title', 'right');
  await expect.poll(async () => (await layerState(app, 'menu'))?.visible).toBe(true);
  expect(await menuLabels(app)).toEqual([
    'Play next',
    'Add to queue',
    'Like',
    'Go to artist',
    'Go to album',
    'Copy link',
  ]);
  await menuKeys(app, ['Down', 'Down', 'Return']);
  await expect.poll(() => fixture<number>(app, 'rowLikes()')).toBe(1);

  await viewMouse(app, '.fixture-item[data-row="0"] .title', 'right');
  await expect.poll(async () => (await layerState(app, 'menu'))?.visible).toBe(true);
  await menuKeys(app, ['Down', 'Down', 'Down', 'Return']);
  await expect.poll(async () => (await status(app)).path).toBe('/browse/UCfixture');

  await viewMouse(app, '.fixture-item[data-row="1"] .title', 'right');
  await expect.poll(async () => (await layerState(app, 'menu'))?.visible).toBe(true);
  await menuKeys(app, ['End', 'Return']);
  await expect
    .poll(() => app.evaluate(async ({ clipboard }) => clipboard.readText()))
    .toBe('https://music.youtube.com/watch?v=trk0000002b');
  await expect(musix.shell.locator('#live-region')).toContainText('Link copied');
});

test('text inputs get cut, copy, paste, and select all', async ({ musix }) => {
  const { shell, app } = musix;
  const input = shell.locator('#search-input');
  await input.fill('hello musix');
  await input.click({ button: 'right' });
  await expect.poll(async () => (await layerState(app, 'menu'))?.visible).toBe(true);
  const labels = await menuLabels(app);
  expect(labels.slice(0, 2)).toEqual(['Cut', 'Copy']);
  expect(labels[3]).toBe('Select all');
  await menuKeys(app, ['End', 'Return']);
  await expect
    .poll(() => input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]))
    .toEqual([0, 11]);

  await viewMouse(app, '#fixture-input', 'right');
  await expect.poll(async () => (await layerState(app, 'menu'))?.visible).toBe(true);
  expect((await menuLabels(app)).slice(0, 2)).toEqual(['Cut', 'Copy']);
  await menuKeys(app, ['Escape']);
});

test('browser shortcuts, zoom, and devtools are blocked', async ({ musix }) => {
  const { shell, app } = musix;
  await shell.evaluate(() => {
    (window as unknown as { __marker: number }).__marker = 7;
  });
  await viewEval(app, `window.__marker = 9; true`);
  await shell.locator('body').click({ position: { x: 700, y: 30 } });
  for (const key of [
    'Control+r',
    'F5',
    'Control+Shift+R',
    'Control+p',
    'Control+s',
    'Control+u',
    'Control+f',
    'Control+Shift+I',
    'F12',
  ]) {
    await shell.keyboard.press(key);
  }
  for (const key of ['Control+Equal', 'Control+Minus', 'Control+0', 'Control+Shift+Equal']) {
    await shell.keyboard.press(key);
  }
  await shell.keyboard.down('Control');
  await shell.mouse.move(700, 400);
  await shell.mouse.wheel(0, -400);
  await shell.keyboard.up('Control');
  await shell.waitForTimeout(500);
  expect(await shell.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(7);
  const zoom = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    return win
      ? { factor: win.webContents.getZoomFactor(), devtools: win.webContents.isDevToolsOpened() }
      : null;
  });
  expect(zoom).toEqual({ factor: 1, devtools: false });
  expect(await shell.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    const view = win?.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return candidate.webContents !== undefined && !candidate.webContents.getURL().includes('overlay.html');
    }) as unknown as { webContents: Electron.WebContents } | undefined;
    if (!view) {
      return;
    }
    view.webContents.focus();
    for (const [keyCode, modifiers] of [
      ['R', ['control']],
      ['F5', []],
      ['=', ['control']],
      ['-', ['control']],
    ] as const) {
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [...modifiers] });
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [...modifiers] });
    }
  });
  await shell.waitForTimeout(500);
  expect(await viewEval<number>(app, `window.__marker`)).toBe(9);
  const viewZoom = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    const view = win?.contentView.children.find((child) => {
      const candidate = child as unknown as { webContents?: { getURL(): string } };
      return candidate.webContents !== undefined && !candidate.webContents.getURL().includes('overlay.html');
    }) as unknown as { webContents: Electron.WebContents } | undefined;
    return view?.webContents.getZoomFactor();
  });
  expect(viewZoom).toBe(1);
});

test('custom window controls, drag region, and corners follow the window state', async ({ musix }) => {
  const { shell, app } = musix;
  const isMaximized = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('/renderer/index.html'))
        ?.isMaximized(),
    );
  const region = await shell.evaluate(() => ({
    bar:
      getComputedStyle(document.querySelector('.topbar-inner') as Element)
        .getPropertyValue('-webkit-app-region')
        .trim() ||
      (
        getComputedStyle(document.querySelector('.topbar-inner') as Element) as unknown as Record<
          string,
          string
        >
      ).webkitAppRegion,
    input: (
      getComputedStyle(document.querySelector('#search-input') as Element) as unknown as Record<
        string,
        string
      >
    ).webkitAppRegion,
    button: (
      getComputedStyle(document.querySelector('#window-close') as Element) as unknown as Record<
        string,
        string
      >
    ).webkitAppRegion,
  }));
  expect(region).toEqual({ bar: 'drag', input: 'no-drag', button: 'no-drag' });
  await expect(shell.locator('#window-controls button')).toHaveCount(3);
  expect(
    await shell.evaluate(
      () => getComputedStyle(document.querySelector('.app') as Element).borderTopLeftRadius,
    ),
  ).toBe('12px');
  await shell.locator('#window-maximize').click();
  await expect.poll(isMaximized).toBe(true);
  await expect(shell.locator('html')).toHaveAttribute('data-window', 'maximized');
  await expect(shell.locator('#window-maximize')).toHaveAttribute('aria-label', 'Restore');
  expect(
    await shell.evaluate(
      () => getComputedStyle(document.querySelector('.app') as Element).borderTopLeftRadius,
    ),
  ).toBe('0px');
  await shell.waitForTimeout(500);
  await shell.locator('#window-maximize').click();
  await expect.poll(isMaximized).toBe(false);
  await shell.waitForTimeout(500);
  await shell.locator('.topbar-spacer').dispatchEvent('dblclick');
  await expect.poll(isMaximized).toBe(true);
  await shell.waitForTimeout(500);
  await shell.locator('.topbar-spacer').dispatchEvent('dblclick');
  await expect.poll(isMaximized).toBe(false);
  await shell.locator('#search-input').dispatchEvent('dblclick');
  await shell.waitForTimeout(500);
  expect(await isMaximized()).toBe(false);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    if (!win) {
      return;
    }
    const original = win.minimize.bind(win);
    (globalThis as unknown as { __minimized: number }).__minimized = 0;
    win.minimize = () => {
      (globalThis as unknown as { __minimized: number }).__minimized += 1;
      original();
    };
  });
  await shell.locator('#window-minimize').click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { __minimized: number }).__minimized))
    .toBe(1);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/renderer/index.html'),
    );
    win?.restore();
    win?.show();
  });
  await shell.locator('#window-close').click();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('/renderer/index.html'))
          ?.isVisible(),
      ),
    )
    .toBe(false);
});

test('there is no white flash and the window paints the theme background', async ({ musix }) => {
  const { app, shell } = musix;
  const background = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('/renderer/index.html'))
      ?.getBackgroundColor(),
  );
  expect(['#ffffff', '#ffffffff']).not.toContain(background?.toLowerCase());
  const surfaces = await shell.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    app: getComputedStyle(document.querySelector('.app') as Element).backgroundColor,
  }));
  expect(surfaces.html).toBe('rgba(0, 0, 0, 0)');
  expect(surfaces.app).not.toBe('rgb(255, 255, 255)');
  await viewEval(app, `location.assign('/slow'); true`);
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(false);
  const pixels = await shell.screenshot({ clip: { x: 400, y: 200, width: 40, height: 40 } });
  expect(pixels.length).toBeGreaterThan(0);
  const appBackground = await shell.evaluate(
    () => getComputedStyle(document.querySelector('.view-state') as Element).backgroundColor,
  );
  expect(appBackground).not.toBe('rgb(255, 255, 255)');
  await expect.poll(async () => (await viewInfo(app))?.visible, { timeout: 20000 }).toBe(true);
});

test('native tooltips are replaced by custom ones in the shell and YouTube Music', async ({ musix }) => {
  const { shell, app } = musix;
  await app.evaluate(({ ipcMain }) => {
    (globalThis as unknown as { __tips: string[] }).__tips = [];
    for (const channel of ['overlay:tooltip', 'ytm:desktop', 'overlay:size']) {
      ipcMain.on(channel, (_event, payload) => {
        (globalThis as unknown as { __tips: string[] }).__tips.push(`${channel} ${JSON.stringify(payload)}`);
      });
    }
  });
  expect(await shell.locator('[title]').count()).toBe(0);
  await expect.poll(() => viewEval<number>(app, `document.querySelectorAll('[title]').length`)).toBe(0);
  expect(
    await viewEval<string>(app, `document.querySelector('.shelf-title').getAttribute('data-musix-title')`),
  ).toBe('Fixture shelf tooltip');
  await viewEval(
    app,
    `(() => { document.querySelector('.shelf-title').scrollIntoView({ block: 'center' }); return true; })()`,
  );
  await shell.waitForTimeout(500);
  const hover = (): Promise<unknown> =>
    viewEval(
      app,
      `(() => { document.querySelector('.shelf-title').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true })); return true; })()`,
    );
  await hover();
  await expect
    .poll(
      async () => {
        const log = await app.evaluate(() => (globalThis as unknown as { __tips: string[] }).__tips);
        const shown = log.some(
          (entry) =>
            entry.startsWith('ytm:desktop') &&
            entry.includes('"type":"tooltip"') &&
            entry.includes('Fixture shelf tooltip'),
        );
        if (!shown) {
          await hover();
        }
        return shown;
      },
      { intervals: [600, 800, 1000] },
    )
    .toBe(true);
  const log = await app.evaluate(() => (globalThis as unknown as { __tips: string[] }).__tips);
  const request = log.find((entry) => entry.includes('Fixture shelf tooltip')) ?? '';
  const payload = JSON.parse(request.slice('ytm:desktop '.length)) as {
    rect: { x: number; y: number; width: number; height: number };
  };
  const view = await viewInfo(app);
  expect(payload.rect.width).toBeGreaterThan(0);
  expect(payload.rect.y + payload.rect.height).toBeLessThanOrEqual(view?.bounds.height ?? 0);
});

test('selection, cursor, drag, and focus behave like a native app', async ({ musix }) => {
  const { shell, app } = musix;
  const styles = await shell.evaluate(() => {
    const css = (el: Element | null, prop: string): string =>
      el ? getComputedStyle(el).getPropertyValue(prop) : 'missing';
    return {
      bodySelect: css(document.body, 'user-select'),
      inputSelect: css(document.querySelector('#search-input'), 'user-select'),
      bodyCursor: css(document.body, 'cursor'),
      buttonCursor: css(document.querySelector('#theme-toggle'), 'cursor'),
      inputCursor: css(document.querySelector('#search-input'), 'cursor'),
      imgDrag: (
        getComputedStyle(document.querySelector('.brand-mark') as Element) as unknown as Record<
          string,
          string
        >
      ).webkitUserDrag,
      selection: getComputedStyle(document.body, '::selection').backgroundColor,
      accentSoft: getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim(),
      spellcheck: document.querySelector('#search-input')?.getAttribute('spellcheck'),
      nativeControls: document.querySelectorAll(
        'select, input[type="checkbox"], input[type="radio"], input[type="range"], input[type="color"]',
      ).length,
    };
  });
  expect(styles.bodySelect).toBe('none');
  expect(styles.inputSelect).toBe('text');
  expect(styles.bodyCursor).toBe('default');
  expect(styles.buttonCursor).toBe('pointer');
  expect(styles.inputCursor).toBe('text');
  expect(styles.imgDrag).toBe('none');
  expect(styles.spellcheck).toBe('false');
  expect(styles.nativeControls).toBe(0);
  expect(styles.selection).not.toBe('');
  const ytm = await viewEval<{ select: string; cursor: string }>(
    app,
    `({ select: getComputedStyle(document.querySelector('ytmusic-app')).userSelect, cursor: getComputedStyle(document.querySelector('#page-title')).cursor })`,
  );
  expect(ytm).toEqual({ select: 'none', cursor: 'default' });
  await shell.locator('#theme-toggle').click();
  await shell.locator('#theme-toggle').click();
  const outline = await shell.evaluate(
    () => getComputedStyle(document.activeElement as Element).outlineStyle,
  );
  expect(outline).toBe('none');
  await shell.keyboard.press('Tab');
  const keyboardOutline = await shell.evaluate(
    () => getComputedStyle(document.activeElement as Element).outlineStyle,
  );
  expect(keyboardOutline).toBe('solid');
});

test('middle, ctrl, and shift clicks never open windows', async ({ musix }) => {
  const { app } = musix;
  await app.evaluate(({ shell }) => {
    (globalThis as unknown as { __external: string[] }).__external = [];
    shell.openExternal = (url: string) => {
      (globalThis as unknown as { __external: string[] }).__external.push(url);
      return Promise.resolve();
    };
  });
  await viewMouse(app, '#ext-link', 'middle');
  await viewMouse(app, '#ext-link', 'left', ['control']);
  await viewMouse(app, '#ext-link', 'left', ['shift']);
  await viewEval(app, `true`);
  const result = await app.evaluate(({ BrowserWindow }) => ({
    external: (globalThis as unknown as { __external: string[] }).__external.length,
    windows: BrowserWindow.getAllWindows().length,
  }));
  expect(result).toEqual({ external: 0, windows: 1 });
  expect((await viewInfo(app))?.url).not.toContain('example.com');
});

test('alert, confirm, and prompt use in-app dialogs', async ({ musix }) => {
  const { shell, app } = musix;
  expect(await viewEval<boolean>(app, `confirm('Leave?')`)).toBe(false);
  await shell.locator('[role="alertdialog"] button').click();
  await viewEval(app, `alert('Heads up from YouTube Music'); true`);
  const dialog = shell.locator('[role="alertdialog"]');
  await expect(dialog).toContainText('Heads up from YouTube Music');
  await expect(dialog.locator('button')).toHaveCount(1);
  await dialog.locator('button').click();
  await expect(dialog).toBeHidden();
  await shell.evaluate(() => {
    window.alert('Shell says hello');
  });
  await expect(dialog).toContainText('Shell says hello');
  await shell.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('navigation shows a thin progress bar instead of a blank page', async ({ musix }) => {
  const { shell, app } = musix;
  await viewEval(
    app,
    `document.querySelector('ytmusic-app').dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint: { browseEndpoint: { browseId: 'FEmusic_explore' } } } })); true`,
  );
  await expect(shell.locator('#nav-progress')).toHaveAttribute('data-active', 'false', { timeout: 5000 });
  await shell.evaluate(() => {
    const bar = document.querySelector('#nav-progress');
    (window as unknown as { __progressSeen: boolean }).__progressSeen = false;
    if (bar) {
      new MutationObserver(() => {
        if (bar.getAttribute('data-active') === 'true') {
          (window as unknown as { __progressSeen: boolean }).__progressSeen = true;
        }
      }).observe(bar, { attributes: true });
    }
  });
  await shell.locator('#sidebar [data-nav="library"]').click();
  await expect
    .poll(() => shell.evaluate(() => (window as unknown as { __progressSeen: boolean }).__progressSeen))
    .toBe(true);
  await expect(shell.locator('#nav-progress')).toHaveAttribute('data-active', 'false');
  expect(
    await shell.evaluate(() => getComputedStyle(document.querySelector('#nav-progress') as Element).height),
  ).toBe('2px');
});
