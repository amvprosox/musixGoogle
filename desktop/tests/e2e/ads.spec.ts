import { expect, fixture, startPlayback, test } from './test';

interface AdState {
  ad: boolean;
  skipClicks: number;
  muted: boolean;
  rate: number;
}

test('skippable ads are skipped and playback state is restored', async ({ musix }) => {
  const { app, shell } = musix;
  await startPlayback(musix, 1);
  await fixture(app, 'startAd(true)');
  await expect.poll(() => fixture<AdState>(app, 'adState()')).toMatchObject({ ad: false, skipClicks: 1 });
  await expect.poll(() => fixture<AdState>(app, 'adState()')).toMatchObject({ muted: false, rate: 1 });
  await expect(shell.locator('#player-title')).toHaveText('Night Bus');
  await expect(shell.locator('#ad-badge')).toBeHidden();
});

test('unskippable ads are fast-forwarded muted', async ({ musix }) => {
  const { app } = musix;
  await startPlayback(musix, 0);
  await fixture(app, 'startAd(false)');
  await expect
    .poll(() => fixture<AdState>(app, 'adState()'), { timeout: 20000 })
    .toMatchObject({ ad: false, skipClicks: 0 });
  await expect.poll(() => fixture<AdState>(app, 'adState()')).toMatchObject({ muted: false, rate: 1 });
});

test('the fallback can be disabled from settings', async ({ musix }) => {
  const { app, shell } = musix;
  await startPlayback(musix, 0);
  await shell.locator('#sidebar [data-nav="settings"]').click();
  await shell.locator('#setting-adSkipFallback').click();
  await expect(shell.locator('#setting-adSkipFallback')).toHaveAttribute('aria-checked', 'false');
  await shell.locator('#nav-back').click();
  await fixture(app, 'startAd(true)');
  await expect(shell.locator('#ad-badge')).toBeVisible();
  await expect(shell.locator('#player-title')).toHaveText('Advertisement');
  await expect(shell.locator('#player-like')).toBeDisabled();
  await shell.waitForTimeout(1500);
  expect((await fixture<AdState>(app, 'adState()')).skipClicks).toBe(0);
});
