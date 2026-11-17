import { spawn } from 'node:child_process';
import { chmodSync, createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { app, shell } from 'electron';
import type { UpdateInfo } from '../shared/types';
import { logWarn } from './log';

declare const __MUSIX_BUILD__: number | undefined;
const BUILD = typeof __MUSIX_BUILD__ === 'number' ? __MUSIX_BUILD__ : 0;

const RELEASES = 'https://github.com/amvprosox/musixGoogle/releases';
const LATEST_JSON = `${RELEASES}/latest/download/latest.json`;

interface LatestFile {
  version?: unknown;
  desktopBuild?: unknown;
  files?: unknown;
}

function installerName(files: Record<string, unknown>): string {
  const key = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
  const name = files[key];
  return typeof name === 'string' && /^[\w.-]+$/.test(name) ? name : '';
}

/** Compares this build with the latest release's version file on GitHub. */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = { version: app.getVersion(), build: BUILD };
  const response = await fetch(LATEST_JSON, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Update check failed (HTTP ${response.status})`);
  }
  const latest = (await response.json()) as LatestFile;
  const version = typeof latest.version === 'string' ? latest.version : current.version;
  const build = typeof latest.desktopBuild === 'number' ? latest.desktopBuild : 0;
  const files =
    typeof latest.files === 'object' && latest.files !== null
      ? (latest.files as Record<string, unknown>)
      : {};
  const newerVersion = version.localeCompare(current.version, undefined, { numeric: true }) > 0;
  return {
    available: newerVersion || build > current.build,
    version,
    currentVersion: current.version,
    fileName: installerName(files),
    releaseUrl: `${RELEASES}/latest`,
  };
}

/** Downloads the installer for this computer into Downloads and opens it. */
export async function downloadUpdate(fileName: string): Promise<string> {
  if (!/^[\w.-]+$/.test(fileName)) {
    throw new Error('Invalid file name');
  }
  const target = path.join(app.getPath('downloads'), fileName);
  const partial = `${target}.part`;
  const response = await fetch(`${RELEASES}/latest/download/${fileName}`, {
    signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${response.status})`);
  }
  try {
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      createWriteStream(partial),
    );
    if (existsSync(target)) {
      await rm(target, { force: true });
    }
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
  if (process.platform === 'linux') {
    shell.showItemInFolder(target);
  } else {
    const failure = await shell.openPath(target);
    if (failure !== '') {
      logWarn('updates', `Could not open ${fileName}: ${failure}`);
      shell.showItemInFolder(target);
    }
  }
  return target;
}

/**
 * Automatic install. The update is downloaded in the background, then a small helper script
 * waits for Musix to close, swaps in the new version and (optionally) starts it again:
 * macOS replaces Musix.app, Windows runs the installer silently, Linux replaces the AppImage.
 */
interface StagedUpdate {
  kind: 'mac' | 'windows' | 'appimage';
  path: string;
}

let staged: StagedUpdate | null = null;
let installOnQuit = false;

function updatesDir(): string {
  const dir = path.join(app.getPath('userData'), 'updates');
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function fetchTo(name: string, target: string): Promise<void> {
  const response = await fetch(`${RELEASES}/latest/download/${name}`, {
    signal: AbortSignal.timeout(20 * 60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${response.status})`);
  }
  const expected = Number(response.headers.get('content-length'));
  const partial = `${target}.part`;
  await pipeline(
    Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
    createWriteStream(partial),
  );
  const { size } = await stat(partial);
  if (Number.isFinite(expected) && expected > 0 && size !== expected) {
    await rm(partial, { force: true });
    throw new Error('Download was incomplete');
  }
  await rm(target, { recursive: true, force: true });
  await rename(partial, target);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code}`));
      }
    });
  });
}

/** True when this copy of Musix can replace itself (packaged, and a supported install). */
export function canAutoInstall(): boolean {
  if (!app.isPackaged) {
    return false;
  }
  return process.platform === 'darwin' || process.platform === 'win32' || Boolean(process.env.APPIMAGE);
}

/** Downloads the update for this computer and gets it ready to install. */
export async function prepareUpdate(): Promise<boolean> {
  if (staged) {
    return true;
  }
  if (!canAutoInstall()) {
    return false;
  }
  const response = await fetch(LATEST_JSON, { signal: AbortSignal.timeout(15_000) });
  const latest = (await response.json()) as LatestFile;
  const files =
    typeof latest.files === 'object' && latest.files !== null
      ? (latest.files as Record<string, unknown>)
      : {};
  const version = typeof latest.version === 'string' ? latest.version : app.getVersion();
  // Standard release file names, used when the version file is older than this app.
  const fallback: Record<string, string> = {
    macZip: `Musix-${version}-mac.zip`,
    windows: `Musix-Setup-${version}.exe`,
    linux: `Musix-${version}-x86_64.AppImage`,
  };
  const pick = (key: string): string => {
    const name = files[key] ?? fallback[key];
    return typeof name === 'string' && /^[\w.-]+$/.test(name) ? name : '';
  };
  const dir = updatesDir();
  if (process.platform === 'darwin') {
    const zip = pick('macZip');
    if (zip === '') {
      return false;
    }
    const zipPath = path.join(dir, zip);
    await fetchTo(zip, zipPath);
    const unpacked = path.join(dir, 'mac');
    await rm(unpacked, { recursive: true, force: true });
    await run('/usr/bin/ditto', ['-x', '-k', zipPath, unpacked]);
    await rm(zipPath, { force: true });
    const bundle = (await readdir(unpacked)).find((entry) => entry.endsWith('.app'));
    if (!bundle) {
      throw new Error('The update has no app inside');
    }
    staged = { kind: 'mac', path: path.join(unpacked, bundle) };
  } else if (process.platform === 'win32') {
    const setup = pick('windows');
    if (setup === '') {
      return false;
    }
    const target = path.join(dir, setup);
    await fetchTo(setup, target);
    staged = { kind: 'windows', path: target };
  } else {
    const image = pick('linux');
    if (image === '') {
      return false;
    }
    const target = path.join(dir, image);
    await fetchTo(image, target);
    chmodSync(target, 0o755);
    staged = { kind: 'appimage', path: target };
  }
  return true;
}

function launchInstaller(relaunch: boolean): void {
  if (!staged) {
    return;
  }
  const dir = updatesDir();
  const pid = String(process.pid);
  if (staged.kind === 'mac') {
    const appPath = path.resolve(process.execPath, '..', '..', '..');
    const script = path.join(dir, 'install.sh');
    writeFileSync(
      script,
      `#!/bin/bash
APP="$1"; NEW="$2"; PID="$3"; RELAUNCH="$4"
while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done
rm -rf "$APP.old"
if mv "$APP" "$APP.old" && /usr/bin/ditto "$NEW" "$APP"; then rm -rf "$APP.old"; else rm -rf "$APP"; mv "$APP.old" "$APP"; fi
/usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null
rm -rf "$NEW"
if [ "$RELAUNCH" = "1" ]; then /usr/bin/open "$APP"; fi
`,
      { mode: 0o755 },
    );
    spawn('/bin/bash', [script, appPath, staged.path, pid, relaunch ? '1' : '0'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else if (staged.kind === 'windows') {
    const script = path.join(dir, 'install.cmd');
    writeFileSync(
      script,
      `@echo off\r\n:wait\r\ntasklist /FI "PID eq %3" 2>NUL | find "%3" >NUL && (timeout /t 1 /nobreak >NUL & goto wait)\r\nstart /wait "" "%1" /S\r\nif "%4"=="1" start "" "%2"\r\n`,
    );
    spawn('cmd.exe', ['/c', script, staged.path, process.execPath, pid, relaunch ? '1' : '0'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } else {
    const image = process.env.APPIMAGE ?? '';
    const script = path.join(dir, 'install.sh');
    writeFileSync(
      script,
      `#!/bin/sh
OLD="$1"; NEW="$2"; PID="$3"; RELAUNCH="$4"
while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done
mv -f "$NEW" "$OLD" && chmod +x "$OLD"
if [ "$RELAUNCH" = "1" ]; then nohup "$OLD" >/dev/null 2>&1 & fi
`,
      { mode: 0o755 },
    );
    spawn('/bin/sh', [script, image, staged.path, pid, relaunch ? '1' : '0'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
  staged = null;
}

/** Installs the downloaded update: now with a restart, or quietly the next time Musix closes. */
export function installUpdate(restartNow: boolean): boolean {
  if (!staged) {
    return false;
  }
  if (restartNow) {
    launchInstaller(true);
    app.quit();
  } else {
    installOnQuit = true;
  }
  return true;
}

app.on('will-quit', () => {
  if (installOnQuit && staged) {
    launchInstaller(false);
  }
});
