import { closeApp, launchApp, viewEval, viewInfo } from './helpers';
import { expect, test } from '@playwright/test';

test.skip(process.env.E2E_LIVE !== '1', 'Set E2E_LIVE=1 to run against the real music.youtube.com');

test('shows synced lyrics that follow playback and search suggestions', async () => {
  test.setTimeout(240000);
  const launched = await launchApp();
  try {
    const { shell, app } = launched;
    await expect.poll(async () => (await viewInfo(app))?.visible, { timeout: 60000 }).toBe(true);
    await viewEval(app, `location.assign('/watch?v=J7p4bzqLvCw'); true`);
    await expect(shell.locator('#ad-badge')).toBeHidden({ timeout: 90000 });
    await expect(shell.locator('#player-title')).toHaveText('Blinding Lights', { timeout: 60000 });
    await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Pause', { timeout: 60000 });

    await shell.locator('#lyrics-toggle').click();
    await expect(shell.locator('#lyrics-panel')).toBeVisible();
    await expect(shell.locator('.lyrics-lines[data-synced="true"]')).toBeVisible({ timeout: 30000 });
    await expect(shell.locator('.lyrics-footer')).toContainText('LRCLIB');

    const target = shell.locator('.lyric-line', { hasText: 'Sin City' }).first();
    await target.click();
    await expect(target).toHaveClass(/is-active/, { timeout: 5000 });
    const elapsed = await shell.locator('.full-player .progress-row .time').first().textContent();
    expect(elapsed).toMatch(/^[01]:\d\d$/);
    await expect(shell.locator('.lyric-line.is-active')).not.toHaveText(/Sin City/, { timeout: 20000 });
    await shell.screenshot({ path: 'test-results/lyrics-live.png' });

    await shell.locator('#player-play').click();
    await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Play', { timeout: 2000 });
    await shell.locator('#player-play').click();
    await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Pause', { timeout: 2000 });

    await shell.locator('#lyrics-close').click();
    await expect(shell.locator('#lyrics-panel')).toBeHidden();
    await shell.locator('#search-input').click();
    await shell.locator('#search-input').pressSequentially('blinding li');
    const panel = shell.locator('.suggest-panel').first();
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel.locator('.suggest-row').first()).toContainText('blinding lights');
    await expect(panel.locator('.suggest-item').first()).toBeVisible();
    await shell.screenshot({ path: 'test-results/suggest-live.png' });
    await shell.keyboard.press('ArrowDown');
    await shell.keyboard.press('Enter');
    await expect.poll(async () => (await viewInfo(app))?.url, { timeout: 30000 }).toContain('/search');
  } finally {
    await closeApp(launched);
  }
});
