import { createWriteStream, existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
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
