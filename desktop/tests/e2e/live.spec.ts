import { execFileSync } from 'node:child_process';
import { closeApp, launchApp, viewEval, viewInfo } from './helpers';
import { expect, test } from '@playwright/test';

test.skip(process.env.E2E_LIVE !== '1', 'Set E2E_LIVE=1 to run against the real music.youtube.com');

test('plays a real track on music.youtube.com through the bridge', async () => {
  const launched = await launchApp();
  try {
    const { shell, app } = launched;
    await expect.poll(async () => (await viewInfo(app))?.visible, { timeout: 60000 }).toBe(true);
    expect((await viewInfo(app))?.url).toContain('music.youtube.com');
    await shell.locator('#sidebar [data-nav="explore"]').click();
    await expect.poll(async () => (await viewInfo(app))?.url, { timeout: 30000 }).toContain('/explore');
    await expect(shell.locator('#sidebar [data-nav="explore"]')).toHaveAttribute('aria-current', 'page');
    await viewEval(app, `location.assign('/watch?v=lYBUbBu4W08'); true`);
    await expect(shell.locator('#player-title')).not.toHaveText(/Nothing playing|^$/, { timeout: 60000 });
    await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Pause', { timeout: 60000 });
    await expect(shell.locator('#ad-badge')).toBeHidden({ timeout: 90000 });
    await expect(shell.locator('#player-title')).toHaveText('Never Gonna Give You Up', { timeout: 60000 });
    await expect
      .poll(() => shell.locator('#queue-table tbody tr').count(), { timeout: 30000 })
      .toBeGreaterThan(5);
    await shell.locator('#player-play').click();
    await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Play');
    await shell.locator('#player-play').click();
    await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Pause');
    await shell.locator('#player-mute').click();
    await expect(shell.locator('#player-mute')).toHaveAttribute('aria-label', 'Unmute');
    await shell.locator('#player-mute').click();
    await expect(shell.locator('#player-mute')).toHaveAttribute('aria-label', 'Mute');
    const pid = app.process().pid;
    await expect
      .poll(
        () =>
          execFileSync('busctl', ['--user', 'list', '--no-pager'], { encoding: 'utf8' })
            .split('\n')
            .some(
              (line) => line.startsWith('org.mpris.MediaPlayer2.') && line.split(/\s+/)[1] === String(pid),
            ),
        { timeout: 20000 },
      )
      .toBe(true);
  } finally {
    await closeApp(launched);
  }
});
