import { execFileSync, spawn } from 'node:child_process';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, launchApp, viewEval, viewInfo, type Launched } from './helpers';

test.skip(
  process.env.E2E_LIVE !== '1',
  'Set E2E_LIVE=1 in a desktop session to verify MPRIS, tray, and notifications against music.youtube.com',
);

interface MenuItem {
  id: string;
  label: string;
}

function busNames(pid: number): string[] {
  return execFileSync('busctl', ['--user', 'list', '--no-pager'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.split(/\s+/)[1] === String(pid))
    .map((line) => line.split(/\s+/)[0] ?? '');
}

function mprisGet(name: string, iface: string, prop: string): string {
  return execFileSync(
    'gdbus',
    [
      'call',
      '--session',
      '--dest',
      name,
      '--object-path',
      '/org/mpris/MediaPlayer2',
      '--method',
      'org.freedesktop.DBus.Properties.Get',
      iface,
      prop,
    ],
    { encoding: 'utf8' },
  );
}

function mprisCall(name: string, method: string): void {
  execFileSync('gdbus', [
    'call',
    '--session',
    '--dest',
    name,
    '--object-path',
    '/org/mpris/MediaPlayer2',
    '--method',
    `org.mpris.MediaPlayer2.Player.${method}`,
  ]);
}

function menuItems(service: string): MenuItem[] {
  const layout = execFileSync(
    'busctl',
    [
      '--user',
      'call',
      service,
      '/com/canonical/dbusmenu',
      'com.canonical.dbusmenu',
      'GetLayout',
      'iias',
      '0',
      '3',
      '0',
    ],
    { encoding: 'utf8' },
  );
  return [...layout.matchAll(/\(ia\{sv\}av\) (\d+) \d+ ([^(]*)/g)]
    .map((match) => ({
      id: match[1] ?? '',
      label: /"label" s "([^"]*)"/.exec(match[2] ?? '')?.[1] ?? '',
    }))
    .filter((item) => item.label !== '');
}

function clickMenu(service: string, id: string): void {
  execFileSync('busctl', [
    '--user',
    'call',
    service,
    '/com/canonical/dbusmenu',
    'com.canonical.dbusmenu',
    'Event',
    'isvu',
    id,
    'clicked',
    's',
    '',
    '0',
  ]);
}

async function startTrack(app: ElectronApplication, shell: Page): Promise<void> {
  await expect.poll(async () => (await viewInfo(app))?.visible, { timeout: 60000 }).toBe(true);
  await viewEval(app, `location.assign('/watch?v=lYBUbBu4W08&list=RDAMVMlYBUbBu4W08'); true`);
  await expect(shell.locator('#player-title')).toHaveText('Never Gonna Give You Up', { timeout: 120000 });
  await shell.locator('#player-mute').click();
  await expect(shell.locator('#player-mute')).toHaveAttribute('aria-label', 'Unmute');
}

test('MPRIS, tray menu, and notifications reflect and control real playback', async () => {
  test.setTimeout(240000);
  let launched: Launched | null = null;
  try {
    launched = await launchApp();
    const { app, shell } = launched;
    const pid = app.process().pid;
    expect(pid).toBeDefined();
    await startTrack(app, shell);

    let mpris = '';
    await expect
      .poll(
        () => {
          mpris = busNames(pid ?? 0).find((name) => name.startsWith('org.mpris.MediaPlayer2.')) ?? '';
          return mpris;
        },
        { timeout: 20000 },
      )
      .not.toBe('');
    expect(mprisGet(mpris, 'org.mpris.MediaPlayer2', 'Identity')).toContain('Musix');
    const metadata = mprisGet(mpris, 'org.mpris.MediaPlayer2.Player', 'Metadata');
    expect(metadata).toContain("'xesam:title': <'Never Gonna Give You Up'>");
    expect(metadata).toContain("'xesam:artist': <['Rick Astley']>");
    expect(metadata).toContain('mpris:artUrl');
    mprisCall(mpris, 'PlayPause');
    await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Play');
    expect(mprisGet(mpris, 'org.mpris.MediaPlayer2.Player', 'PlaybackStatus')).toContain('Paused');
    mprisCall(mpris, 'PlayPause');
    await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', 'Pause');

    const tray =
      busNames(pid ?? 0).find((name) => name.startsWith('org.freedesktop.StatusNotifierItem-')) ?? '';
    expect(tray).not.toBe('');
    await expect
      .poll(() => menuItems(tray).map((item) => item.label))
      .toEqual(['Never Gonna Give You Up - Rick Astley', 'Pause', 'Next', 'Previous', 'Hide window', 'Quit']);
    const clickUntil = async (label: string, expected: string): Promise<void> => {
      await expect(async () => {
        const item = menuItems(tray).find((entry) => entry.label === label);
        expect(item).toBeDefined();
        clickMenu(tray, item?.id ?? '');
        await expect(shell.locator('#player-play')).toHaveAttribute('aria-label', expected, {
          timeout: 3000,
        });
      }).toPass({ timeout: 30000 });
    };
    await clickUntil('Pause', 'Play');
    await expect.poll(() => menuItems(tray).some((item) => item.label === 'Play')).toBe(true);
    await clickUntil('Play', 'Pause');

    const monitor = spawn(
      'dbus-monitor',
      ['--session', "interface='org.freedesktop.Notifications',member='Notify'"],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    let captured = '';
    monitor.stdout.on('data', (chunk: Buffer) => {
      captured += chunk.toString('utf8');
    });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('/renderer/index.html'))
        ?.hide();
    });
    await expect.poll(() => menuItems(tray).some((item) => item.label === 'Show window')).toBe(true);
    mprisCall(mpris, 'Next');
    await expect(shell.locator('#player-title')).not.toHaveText('Never Gonna Give You Up', {
      timeout: 30000,
    });
    const nextTitle = (await shell.locator('#player-title').textContent()) ?? '';
    await expect.poll(() => captured.includes(`string "${nextTitle}"`), { timeout: 15000 }).toBe(true);
    monitor.kill();
    expect(captured).toContain('string "Musix"');
    expect(captured).toContain('image-data');
    expect(captured).not.toContain('string "Never Gonna Give You Up"');
  } finally {
    if (launched) {
      await closeApp(launched);
    }
  }
});
