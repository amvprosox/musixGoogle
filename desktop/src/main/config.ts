import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { YTM_ORIGIN } from '../shared/constants';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, '..');
const rootDir = path.resolve(distDir, '..');

export const paths = {
  shellHtml: path.join(distDir, 'renderer', 'index.html'),
  overlayHtml: path.join(distDir, 'renderer', 'overlay.html'),
  shellPreload: path.join(distDir, 'preload', 'shell.cjs'),
  ytmPreload: path.join(distDir, 'preload', 'ytm.cjs'),
  overlayPreload: path.join(distDir, 'preload', 'overlay.cjs'),
  iconsDir: path.join(rootDir, 'assets', 'icons'),
  fontsDir: path.join(rootDir, 'assets', 'fonts'),
};

export function appIconPath(size: number): string {
  return path.join(paths.iconsDir, `${size}x${size}.png`);
}

function devOverride(name: string): string | null {
  if (app.isPackaged) {
    return null;
  }
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  return value.trim();
}

export function ytmBaseUrl(): string {
  const override = devOverride('MUSIX_YTM_URL');
  if (override) {
    try {
      const parsed = new URL(override);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      return YTM_ORIGIN;
    }
  }
  return YTM_ORIGIN;
}

export function userDataOverride(): string | null {
  return devOverride('MUSIX_USER_DATA');
}

export function isTestRun(): boolean {
  return devOverride('MUSIX_E2E') === '1';
}

export function chromeUserAgent(): string {
  const chromeVersion = process.versions.chrome;
  const major = typeof chromeVersion === 'string' ? chromeVersion.split('.')[0] : '';
  const version = major !== undefined && major !== '' ? major : '140';
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
}
