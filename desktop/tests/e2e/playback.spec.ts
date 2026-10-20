import { viewEval } from './helpers';
import { expect, startPlayback, status, test } from './test';

test('play, pause, next, and previous update the UI from bridge state', async ({ musix }) => {
  const { shell, app } = musix;
  await startPlayback(musix, 0);
  await expect(shell.locator('#player-title')).toHaveText('Signal Fire');
  await expect(shell.locator('#player-artist')).toHaveText('The Testers • Fixtures Vol 1');
  await shell.locator('#player-play').click();
  await expect.poll(async () => (await status(app)).paused).toBe(true);
  await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Play');
  await shell.locator('#player-play').click();
  await expect.poll(async () => (await status(app)).paused).toBe(false);
  await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Pause');
  await shell.locator('#player-next').click();
  await expect(shell.locator('#player-title')).toHaveText('Night Bus');
  await expect.poll(async () => (await status(app)).index).toBe(1);
  await shell.locator('#player-previous').click();
  await expect(shell.locator('#player-title')).toHaveText('Signal Fire');
});

test('seeking and volume use the custom sliders', async ({ musix }) => {
  const { shell, app } = musix;
  await startPlayback(musix, 0);
  await expect(shell.locator('#player-total')).toHaveText('2:00');
  const progress = shell.locator('#player-progress');
  const box = await progress.boundingBox();
  if (!box) {
    throw new Error('progress slider missing');
  }
  await shell.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect.poll(async () => Math.round((await status(app)).currentTime / 10)).toBe(6);
  await expect
    .poll(async () => Number.parseFloat((await progress.getAttribute('aria-valuenow')) ?? '0'))
    .toBeGreaterThan(55);

  const volume = shell.locator('#player-volume');
  const vbox = await volume.boundingBox();
  if (!vbox) {
    throw new Error('volume slider missing');
  }
  await shell.mouse.move(vbox.x + vbox.width * 0.9, vbox.y + vbox.height / 2);
  await shell.mouse.down();
  await shell.mouse.move(vbox.x + vbox.width * 0.5, vbox.y + vbox.height / 2, { steps: 5 });
  await shell.mouse.move(vbox.x + vbox.width * 0.25, vbox.y + vbox.height / 2, { steps: 5 });
  await shell.mouse.up();
  await expect.poll(async () => (await status(app)).volume).toBeGreaterThanOrEqual(22);
  await expect.poll(async () => (await status(app)).volume).toBeLessThanOrEqual(28);
  await expect
    .poll(async () => Number.parseFloat((await volume.getAttribute('aria-valuenow')) ?? '0'))
    .toBeLessThan(0.3);

  await volume.focus();
  await volume.press('ArrowRight');
  await expect.poll(async () => (await status(app)).volume).toBeGreaterThanOrEqual(27);
});

test('mute, like, shuffle, and repeat toggle from bridge state', async ({ musix }) => {
  const { shell, app } = musix;
  await startPlayback(musix, 0);
  await shell.locator('#player-mute').click();
  await expect.poll(async () => (await status(app)).muted).toBe(true);
  await expect(shell.locator('#player-mute')).toHaveAttribute('aria-label', 'Unmute');
  await expect(shell.locator('#player-mute .icon')).toHaveAttribute('data-icon', 'volume-x');
  await shell.locator('#player-mute').click();
  await expect.poll(async () => (await status(app)).muted).toBe(false);

  await shell.locator('#player-like').click();
  await expect.poll(async () => (await status(app)).like).toBe('LIKE');
  await expect(shell.locator('#player-like')).toHaveAttribute('aria-pressed', 'true');

  await shell.locator('#player-shuffle').click();
  await expect.poll(async () => (await status(app)).shuffle).toBe(true);
  await expect(shell.locator('#player-shuffle')).toHaveAttribute('aria-pressed', 'true');

  const repeat = shell.locator('#player-repeat');
  await repeat.click();
  await expect(repeat).toHaveAttribute('aria-label', 'Repeat all');
  await repeat.click();
  await expect(repeat).toHaveAttribute('aria-label', 'Repeat one');
  await expect(shell.locator('#player-repeat .icon')).toHaveAttribute('data-icon', 'repeat-1');
  await repeat.click();
  await expect(repeat).toHaveAttribute('aria-label', 'Repeat off');
  expect((await status(app)).repeat).toBe('NONE');
});

test('optimistic play state reverts when the bridge does not confirm', async ({ musix }) => {
  const { shell, app } = musix;
  await startPlayback(musix, 0);
  await viewEval(
    app,
    `(() => { const b = document.querySelector('#play-pause-button'); b.replaceWith(b.cloneNode(true)); return true; })()`,
  );
  await shell.locator('#player-play').click();
  await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Play', { timeout: 500 });
  await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Pause', { timeout: 3000 });
  expect((await status(app)).paused).toBe(false);
});
