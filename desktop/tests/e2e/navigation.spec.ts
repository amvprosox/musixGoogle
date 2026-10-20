import { expect, status, test } from './test';
import { viewInfo } from './helpers';

const NAV: [string, string][] = [
  ['explore', '/explore'],
  ['library', '/library'],
  ['liked', '/browse/VLLM'],
  ['playlists', '/library/playlists'],
  ['home', '/'],
];

test('sidebar navigation changes the YouTube Music URL and the active item', async ({ musix }) => {
  const { shell, app } = musix;
  for (const [route, path] of NAV) {
    await shell.locator(`#sidebar [data-nav="${route}"]`).click();
    await expect.poll(async () => (await status(app)).path).toBe(path);
    await expect(shell.locator(`#sidebar [data-nav="${route}"]`)).toHaveAttribute('aria-current', 'page');
    await expect(shell.locator('#sidebar [aria-current="page"]')).toHaveCount(1);
  }
});

test('search submits and navigates to results', async ({ musix }) => {
  const { shell, app } = musix;
  const input = shell.locator('#search-input');
  await input.click();
  await input.fill('night bus');
  await input.press('Enter');
  await expect.poll(async () => (await status(app)).path).toBe('/search?q=night+bus');
  await expect(shell.locator('#sidebar [aria-current="page"]')).toHaveCount(0);
  await expect(input).toHaveValue('night bus');
});

test('back and forward follow YouTube Music history', async ({ musix }) => {
  const { shell, app } = musix;
  await shell.locator('#sidebar [data-nav="explore"]').click();
  await expect.poll(async () => (await status(app)).path).toBe('/explore');
  await shell.locator('#sidebar [data-nav="library"]').click();
  await expect.poll(async () => (await status(app)).path).toBe('/library');
  await expect(shell.locator('#nav-back')).toBeEnabled();
  await shell.locator('#nav-back').click();
  await expect.poll(async () => (await status(app)).path).toBe('/explore');
  await expect(shell.locator('#sidebar [data-nav="explore"]')).toHaveAttribute('aria-current', 'page');
  await expect(shell.locator('#nav-forward')).toBeEnabled();
  await shell.locator('#nav-forward').click();
  await expect.poll(async () => (await status(app)).path).toBe('/library');
});

test('settings replaces the view and back returns to it', async ({ musix }) => {
  const { shell, app } = musix;
  await shell.locator('#sidebar [data-nav="settings"]').click();
  await expect(shell.locator('#settings-page')).toBeVisible();
  await expect(shell.locator('#sidebar [data-nav="settings"]')).toHaveAttribute('aria-current', 'page');
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(false);
  await shell.locator('#nav-back').click();
  await expect(shell.locator('#settings-page')).toBeHidden();
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(true);
});
