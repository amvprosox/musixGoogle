import { expect, fixture, test } from './test';

async function blockedCount(shell: import('@playwright/test').Page): Promise<number> {
  const text = (await shell.locator('#adblock-count').textContent()) ?? '0';
  return Number.parseInt(text.replace(/,/g, ''), 10);
}

test('ad blocker toggles live and counts blocked requests', async ({ musix }) => {
  const { shell, app } = musix;
  await shell.locator('#sidebar [data-nav="settings"]').click();
  await expect(shell.locator('#adblock-status')).toHaveAttribute('data-tone', 'success', { timeout: 60000 });
  await expect(shell.locator('#adblock-updated')).not.toHaveText('Never');

  const before = await blockedCount(shell);
  await fixture(app, 'requestAd()');
  await expect.poll(() => blockedCount(shell)).toBeGreaterThan(before);

  await shell.locator('#setting-adblockEnabled').click();
  await expect(shell.locator('#setting-adblockEnabled')).toHaveAttribute('aria-checked', 'false');
  await expect(shell.locator('#adblock-status')).toContainText('Ad blocker is off');
  const whileOff = await blockedCount(shell);
  await fixture(app, 'requestAd()');
  await shell.waitForTimeout(1500);
  expect(await blockedCount(shell)).toBe(whileOff);

  await shell.locator('#setting-adblockEnabled').click();
  await expect(shell.locator('#adblock-status')).toHaveAttribute('data-tone', 'success');
  await fixture(app, 'requestAd()');
  await expect.poll(() => blockedCount(shell)).toBeGreaterThan(whileOff);
});

test('update now shows loading and a result state', async ({ musix }) => {
  const { shell } = musix;
  await shell.locator('#sidebar [data-nav="settings"]').click();
  const button = shell.locator('#adblock-update');
  await button.click();
  await expect(button).toHaveAttribute('data-state', /loading|success|error/);
  await expect(button).toHaveAttribute('data-state', /success|error/, { timeout: 90000 });
  const state = await button.getAttribute('data-state');
  if (state === 'success') {
    await expect(button).toContainText('Up to date');
  } else {
    await expect(button).toContainText('Update failed');
  }
  await expect(button).toHaveAttribute('data-state', 'idle', { timeout: 10000 });
});
