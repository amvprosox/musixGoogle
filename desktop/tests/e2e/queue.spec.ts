import { setWindowSize, viewInfo } from './helpers';
import { expect, fixture, startPlayback, status, test } from './test';

test('queue lists items and clicking a row plays it', async ({ musix }) => {
  const { shell, app } = musix;
  await startPlayback(musix, 0);
  const panel = shell.locator('#queue-panel');
  await expect(panel).toBeVisible();
  const rows = shell.locator('#queue-table tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(rows.nth(2).locator('.queue-title')).toHaveText(
    'Paper Planes Over Lisbon In The Late Afternoon Light',
  );
  await rows.nth(3).click();
  await expect.poll(async () => (await status(app)).index).toBe(3);
  await expect(shell.locator('#player-title')).toHaveText('Quiet Hours');
  await expect(rows.nth(3)).toHaveAttribute('aria-current', 'true');
  await rows.nth(1).focus();
  await rows.nth(1).press('Enter');
  await expect.poll(async () => (await status(app)).index).toBe(1);
});

test('queue shows an empty state', async ({ musix }) => {
  const { shell, app } = musix;
  await fixture(app, 'clearQueue()');
  await expect(shell.locator('#queue-empty')).toBeVisible();
  await expect(shell.locator('#queue-count')).toHaveText('0');
});

test('queue toggles docked and opens as a drawer on medium screens', async ({ musix }) => {
  const { shell, app } = musix;
  const toggle = shell.locator('#queue-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(shell.locator('#queue-panel')).toBeHidden();
  await toggle.click();
  await expect(shell.locator('#queue-panel')).toBeVisible();

  await setWindowSize(app, 1024, 768);
  await expect(shell.locator('#app')).toHaveAttribute('data-bp', 'md');
  await expect(shell.locator('#app')).toHaveAttribute('data-queue-open', 'false');
  await toggle.click();
  await expect(shell.locator('#app')).toHaveAttribute('data-queue-open', 'true');
  await expect(shell.locator('#backdrop')).toHaveAttribute('data-open', 'true');
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(false);
  await expect(shell.locator('#view-freeze')).toBeVisible();
  await expect(shell.locator('#queue-close')).toBeFocused();
  await shell.keyboard.press('Escape');
  await expect(shell.locator('#app')).toHaveAttribute('data-queue-open', 'false');
  await expect(toggle).toBeFocused();
  await expect.poll(async () => (await viewInfo(app))?.visible).toBe(true);
});
