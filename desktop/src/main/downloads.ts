import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { Session, WebContents } from 'electron';
import { isBoundedString, isFiniteNumber, isRecord, isString } from '../shared/guards';
import type { DownloadItem, DownloadStatus, DownloadTrackRequest } from '../shared/types';
import { isVideoId } from '../shared/validators';
import { logError, logWarn } from './log';

const STORE_FILE = 'downloads.json';
const CHUNK_SIZE = 524_288;
const PROGRESS_THROTTLE_MS = 180;

const YTDLP_URLS: Readonly<Record<string, string>> = {
  'linux-x64': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux',
  'linux-arm64': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64',
  'darwin-x64': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  'darwin-arm64': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
  'win32-x64': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  'win32-arm64': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_arm64.exe',
};

interface InnertubeClientSpec {
  readonly name: string;
  readonly version: string;
  readonly ua: string;
  readonly sdk?: number;
}

const INNERTUBE_CLIENTS: readonly InnertubeClientSpec[] = [
  {
    name: 'ANDROID_VR',
    version: '1.60.19',
    ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    sdk: 32,
  },
  {
    name: 'ANDROID',
    version: '20.10.38',
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
    sdk: 34,
  },
  {
    name: 'IOS',
    version: '20.10.4',
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  },
];

interface ResolvedStream {
  readonly url: string;
  readonly contentLength: number;
  readonly userAgent: string;
}

function isDownloadStatus(value: unknown): value is DownloadStatus {
  return value === 'downloading' || value === 'completed' || value === 'failed';
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function parseStoredItem(raw: unknown): DownloadItem | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (
    !isBoundedString(raw.id, 64) ||
    !isVideoId(raw.videoId) ||
    !isBoundedString(raw.title, 2000) ||
    !isBoundedString(raw.artist, 2000) ||
    !isBoundedString(raw.album, 2000) ||
    !isFiniteNumber(raw.durationSec) ||
    !isBoundedString(raw.artworkUrl, 4096) ||
    !isBoundedString(raw.audioUrl, 4096) ||
    !isDownloadStatus(raw.status) ||
    !isFiniteNumber(raw.progress) ||
    !(raw.error === null || isBoundedString(raw.error, 1000)) ||
    !isFiniteNumber(raw.createdAt)
  ) {
    return null;
  }
  const interrupted = raw.status === 'downloading';
  return {
    id: raw.id,
    videoId: raw.videoId,
    title: raw.title,
    artist: raw.artist,
    album: raw.album,
    durationSec: Math.max(0, raw.durationSec),
    artworkUrl: raw.artworkUrl,
    audioUrl: raw.audioUrl,
    status: interrupted ? 'failed' : raw.status,
    progress: interrupted ? 0 : Math.min(1, Math.max(0, raw.progress)),
    error: interrupted ? 'Download interrupted' : raw.error,
    createdAt: raw.createdAt,
  };
}

function alternateVideoUrls(rawUrl: string): string[] {
  const results = [rawUrl];
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.hostname.endsWith('.googlevideo.com')) {
      return results;
    }
    const mn = parsed.searchParams.get('mn');
    if (!mn) {
      return results;
    }
    const mirrors = mn
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && /^[a-z0-9-]+$/i.test(part));
    for (const mirror of mirrors) {
      for (let idx = 1; idx <= 5; idx += 1) {
        const candidateHost = `rr${idx}---${mirror}.googlevideo.com`;
        if (candidateHost !== parsed.hostname) {
          const next = new URL(rawUrl);
          next.hostname = candidateHost;
          results.push(next.toString());
        }
      }
    }
  } catch {
    return results;
  }
  return results;
}

function findBinaryInPath(binaryName: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  const ext = process.platform === 'win32' ? ['.exe', ''] : [''];
  const dirs = pathEnv.split(path.delimiter).filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    for (const suffix of ext) {
      const candidate = path.join(dir, `${binaryName}${suffix}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function parseYtdlpProgress(line: string): number | null {
  const match = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
  if (!match || !match[1]) {
    return null;
  }
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.min(0.99, Math.max(0, value / 100));
}

function upgradeArtworkUrl(artworkUrl: string, videoId: string): string {
  const trimmed = artworkUrl.trim();
  if (trimmed.startsWith('https://')) {
    return trimmed.replace(/=w\d+-h\d+[^&?]*/g, '=w544-h544-l90-rj');
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export class DownloadManager {
  readonly downloadsDir: string;
  private readonly toolsDir: string;
  private readonly storePath: string;
  private items: DownloadItem[] = [];
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private readonly listeners = new Set<(items: DownloadItem[]) => void>();
  private cachedVisitorData = '';

  constructor(
    userDataDir: string,
    private readonly ytmSession: Session,
    private readonly getYtmContents: () => WebContents | null,
  ) {
    this.downloadsDir = path.join(userDataDir, 'downloads');
    this.toolsDir = path.join(userDataDir, 'tools');
    this.storePath = path.join(this.downloadsDir, STORE_FILE);
    mkdirSync(this.downloadsDir, { recursive: true });
    this.load();
  }

  list(): DownloadItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  onChanged(listener: (items: DownloadItem[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    for (const controller of this.activeControllers.values()) {
      controller.abort();
    }
    this.activeControllers.clear();
    for (const proc of this.activeProcesses.values()) {
      try {
        proc.kill('SIGKILL');
      } catch (error) {
        logWarn('downloads', 'Failed to terminate helper process', error);
      }
    }
    this.activeProcesses.clear();
  }

  startDownload(track: DownloadTrackRequest): DownloadItem {
    const existing = this.items.find((item) => item.videoId === track.videoId);
    if (existing && (existing.status === 'downloading' || existing.status === 'completed')) {
      const audioFile = path.join(this.downloadsDir, `${track.videoId}.mp3`);
      if (existing.status === 'downloading' || existsSync(audioFile)) {
        return { ...existing };
      }
    }

    const now = Date.now();
    const item: DownloadItem = {
      id: track.videoId,
      videoId: track.videoId,
      title: track.title.trim(),
      artist: track.artist.trim(),
      album: track.album.trim(),
      durationSec: Math.max(0, Math.round(track.durationSec)),
      artworkUrl: track.artworkUrl,
      audioUrl: '',
      status: 'downloading',
      progress: 0,
      error: null,
      createdAt: now,
    };

    this.items = [item, ...this.items.filter((entry) => entry.videoId !== track.videoId)];
    this.persist();
    this.emit();

    const controller = new AbortController();
    this.activeControllers.set(track.videoId, controller);
    void this.runDownload(item, controller.signal);

    return { ...item };
  }

  async deleteDownload(videoId: string): Promise<boolean> {
    if (!isVideoId(videoId)) {
      return false;
    }
    const controller = this.activeControllers.get(videoId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(videoId);
    }
    const proc = this.activeProcesses.get(videoId);
    if (proc) {
      try {
        proc.kill('SIGKILL');
      } catch (error) {
        logWarn('downloads', 'Failed to kill download process', error);
      }
      this.activeProcesses.delete(videoId);
    }

    const before = this.items.length;
    this.items = this.items.filter((item) => item.videoId !== videoId);
    this.persist();
    this.emit();

    const candidates = [
      path.join(this.downloadsDir, `${videoId}.mp3`),
      path.join(this.downloadsDir, `${videoId}.jpg`),
      path.join(this.downloadsDir, `${videoId}.part`),
      path.join(this.downloadsDir, `${videoId}.raw`),
    ];
    for (const file of candidates) {
      try {
        if (existsSync(file)) {
          await fsp.unlink(file);
        }
      } catch (error) {
        logWarn('downloads', 'Failed to remove file', error);
      }
    }
    return this.items.length !== before;
  }

  private load(): void {
    if (!existsSync(this.storePath)) {
      this.items = [];
      return;
    }
    try {
      const raw: unknown = JSON.parse(readFileSync(this.storePath, 'utf8'));
      if (!Array.isArray(raw)) {
        this.items = [];
        return;
      }
      const parsed: DownloadItem[] = [];
      for (const entry of raw) {
        const item = parseStoredItem(entry);
        if (item) {
          parsed.push(item);
        }
      }
      this.items = parsed;
      this.persist();
    } catch (error) {
      logError('downloads', 'Failed to read downloads.json', error);
      this.items = [];
    }
  }

  private persist(): void {
    try {
      mkdirSync(this.downloadsDir, { recursive: true });
      const tmp = `${this.storePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.items, null, 2), 'utf8');
      renameSync(tmp, this.storePath);
    } catch (error) {
      logError('downloads', 'Failed to persist downloads.json', error);
    }
  }

  private emit(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private updateItem(videoId: string, patch: Partial<DownloadItem>, save = false): void {
    const idx = this.items.findIndex((entry) => entry.videoId === videoId);
    if (idx === -1) {
      return;
    }
    const current = this.items[idx];
    if (!current) {
      return;
    }
    this.items[idx] = { ...current, ...patch };
    if (save) {
      this.persist();
    }
    this.emit();
  }

  private async runDownload(item: DownloadItem, signal: AbortSignal): Promise<void> {
    const { videoId } = item;
    const finalAudioPath = path.join(this.downloadsDir, `${videoId}.mp3`);
    try {
      const localArtwork = await this.downloadThumbnail(videoId, item.artworkUrl, signal);
      if (isAborted(signal)) {
        return;
      }
      if (localArtwork) {
        this.updateItem(videoId, { artworkUrl: localArtwork }, true);
      }

      let downloaded = false;
      try {
        downloaded = await this.downloadViaDirectStream(videoId, finalAudioPath, signal);
      } catch (streamErr) {
        logWarn('downloads', 'Direct stream download failed, trying yt-dlp fallback', streamErr);
      }

      if (!downloaded && !isAborted(signal)) {
        downloaded = await this.downloadViaYtdlp(videoId, finalAudioPath, signal);
      }

      if (isAborted(signal)) {
        return;
      }
      if (!downloaded || !existsSync(finalAudioPath)) {
        throw new Error('Could not download MP3 audio stream');
      }

      this.updateItem(
        videoId,
        {
          audioUrl: `musix-asset://downloads/${videoId}.mp3`,
          status: 'completed',
          progress: 1,
          error: null,
        },
        true,
      );
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Download failed';
      logError('downloads', `Download failed for ${videoId}`, error);
      this.updateItem(
        videoId,
        {
          status: 'failed',
          progress: 0,
          error: message,
        },
        true,
      );
    } finally {
      this.activeControllers.delete(videoId);
      this.activeProcesses.delete(videoId);
    }
  }

  private async downloadThumbnail(
    videoId: string,
    artworkUrl: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const urls = [upgradeArtworkUrl(artworkUrl, videoId), `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`];
    const dest = path.join(this.downloadsDir, `${videoId}.jpg`);
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          continue;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength < 128) {
          continue;
        }
        await fsp.writeFile(dest, bytes);
        return `musix-asset://downloads/${videoId}.jpg`;
      } catch {
        if (signal.aborted) {
          return null;
        }
      }
    }
    return null;
  }

  private async resolveVisitorData(signal: AbortSignal): Promise<string> {
    const wc = this.getYtmContents();
    if (wc && !wc.isDestroyed()) {
      try {
        const result: unknown = await wc.executeJavaScript(
          "(() => { try { return (window.ytcfg && window.ytcfg.get && window.ytcfg.get('VISITOR_DATA')) || ''; } catch { return ''; } })()",
        );
        if (isString(result) && result.length > 10) {
          this.cachedVisitorData = result;
          return result;
        }
      } catch (error) {
        logWarn('downloads', 'Failed to read visitor data from WebContents', error);
      }
    }
    if (this.cachedVisitorData.length > 10) {
      return this.cachedVisitorData;
    }
    try {
      const response = await fetch('https://music.youtube.com', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        signal,
      });
      const html = await response.text();
      const match = /"VISITOR_DATA":"([^"]+)"/.exec(html);
      if (match && match[1]) {
        this.cachedVisitorData = match[1];
        return match[1];
      }
    } catch (error) {
      logWarn('downloads', 'Failed to fetch visitor data', error);
    }
    return '';
  }

  private async resolveDirectAudioStream(
    videoId: string,
    signal: AbortSignal,
  ): Promise<ResolvedStream | null> {
    const visitorData = await this.resolveVisitorData(signal);
    for (const client of INNERTUBE_CLIENTS) {
      if (signal.aborted) {
        return null;
      }
      try {
        const body = {
          videoId,
          context: {
            client: {
              clientName: client.name,
              clientVersion: client.version,
              ...(client.sdk ? { androidSdkVersion: client.sdk } : {}),
              ...(visitorData ? { visitorData } : {}),
              hl: 'en',
              gl: 'US',
            },
          },
          contentCheckOk: true,
          racyCheckOk: true,
        };
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': client.ua,
        };
        if (visitorData) {
          headers['X-Goog-Visitor-Id'] = visitorData;
        }
        const response = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        });
        if (!response.ok) {
          continue;
        }
        const data: unknown = await response.json();
        if (!isRecord(data) || !isRecord(data.streamingData)) {
          continue;
        }
        const adaptive = Array.isArray(data.streamingData.adaptiveFormats)
          ? data.streamingData.adaptiveFormats
          : [];
        const candidates: { url: string; bitrate: number; contentLength: number; isMp4: boolean }[] = [];
        for (const fmt of adaptive) {
          if (!isRecord(fmt) || !isString(fmt.url) || !isString(fmt.mimeType)) {
            continue;
          }
          if (!fmt.mimeType.startsWith('audio/')) {
            continue;
          }
          const contentLength = isString(fmt.contentLength)
            ? Number.parseInt(fmt.contentLength, 10)
            : isFiniteNumber(fmt.contentLength)
              ? fmt.contentLength
              : 0;
          const bitrate = isFiniteNumber(fmt.bitrate) ? fmt.bitrate : 0;
          const isMp4 = fmt.mimeType.startsWith('audio/mp4');
          candidates.push({ url: fmt.url, bitrate, contentLength, isMp4 });
        }
        candidates.sort((a, b) => {
          if (a.isMp4 !== b.isMp4) {
            return a.isMp4 ? -1 : 1;
          }
          return b.bitrate - a.bitrate;
        });
        const best = candidates[0];
        if (best) {
          return {
            url: best.url,
            contentLength:
              Number.isFinite(best.contentLength) && best.contentLength > 0 ? best.contentLength : 0,
            userAgent: client.ua,
          };
        }
      } catch {
        if (isAborted(signal)) {
          return null;
        }
      }
    }
    return null;
  }

  private async downloadViaDirectStream(
    videoId: string,
    finalAudioPath: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const resolved = await this.resolveDirectAudioStream(videoId, signal);
    if (!resolved) {
      return false;
    }
    const rawPath = path.join(this.downloadsDir, `${videoId}.raw`);
    const urls = alternateVideoUrls(resolved.url);
    let urlIndex = 0;
    let totalBytes = resolved.contentLength;
    let downloadedBytes = 0;
    let lastEmit = 0;

    await fsp.writeFile(rawPath, Buffer.alloc(0));

    if (totalBytes <= 0) {
      const response = await fetch(urls[0] ?? resolved.url, {
        headers: { 'User-Agent': resolved.userAgent },
        signal,
      });
      if (!response.ok) {
        return false;
      }
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.byteLength === 0) {
        return false;
      }
      await fsp.writeFile(rawPath, buf);
    } else {
      while (downloadedBytes < totalBytes) {
        if (isAborted(signal)) {
          return false;
        }
        const end = Math.min(downloadedBytes + CHUNK_SIZE - 1, totalBytes - 1);
        let chunkBuf: Buffer | null = null;
        for (let attempt = 0; attempt < Math.min(urls.length, 6); attempt += 1) {
          const targetUrl = urls[(urlIndex + attempt) % urls.length] ?? resolved.url;
          try {
            const response = await fetch(targetUrl, {
              headers: {
                'User-Agent': resolved.userAgent,
                Range: `bytes=${downloadedBytes}-${end}`,
              },
              signal,
            });
            if (response.status === 206 || response.status === 200) {
              const data = Buffer.from(await response.arrayBuffer());
              if (data.byteLength > 0) {
                chunkBuf = data;
                urlIndex = (urlIndex + attempt) % urls.length;
                if (response.status === 200 && downloadedBytes === 0) {
                  totalBytes = data.byteLength;
                }
                break;
              }
            }
          } catch {
            if (isAborted(signal)) {
              return false;
            }
          }
        }
        if (!chunkBuf) {
          throw new Error('Audio stream chunk download failed');
        }
        await fsp.appendFile(rawPath, chunkBuf);
        downloadedBytes += chunkBuf.byteLength;
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_THROTTLE_MS || downloadedBytes >= totalBytes) {
          lastEmit = now;
          const progress = Math.min(0.95, downloadedBytes / totalBytes);
          this.updateItem(videoId, { progress });
        }
      }
    }

    const ffmpegBin = findBinaryInPath('ffmpeg');
    if (ffmpegBin && !signal.aborted) {
      const converted = await this.transcodeToMp3(videoId, ffmpegBin, rawPath, finalAudioPath, signal);
      try {
        if (existsSync(rawPath)) {
          await fsp.unlink(rawPath);
        }
      } catch (error) {
        logWarn('downloads', 'Failed to remove raw file', error);
      }
      if (converted && existsSync(finalAudioPath)) {
        return true;
      }
    }

    await fsp.rename(rawPath, finalAudioPath);
    return existsSync(finalAudioPath);
  }

  private transcodeToMp3(
    videoId: string,
    ffmpegBin: string,
    inputPath: string,
    outputPath: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const tmpOut = `${outputPath}.part.mp3`;
      const proc = spawn(
        ffmpegBin,
        ['-y', '-i', inputPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', tmpOut],
        { stdio: 'ignore', windowsHide: true },
      );
      this.activeProcesses.set(videoId, proc);
      const onAbort = (): void => {
        try {
          proc.kill('SIGKILL');
        } catch (error) {
          logWarn('downloads', 'Failed to kill ffmpeg process', error);
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      proc.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        this.activeProcesses.delete(videoId);
        if (code === 0 && existsSync(tmpOut)) {
          try {
            renameSync(tmpOut, outputPath);
            resolve(true);
            return;
          } catch {
            resolve(false);
            return;
          }
        }
        try {
          if (existsSync(tmpOut)) {
            rmSync(tmpOut, { force: true });
          }
        } catch (error) {
          logWarn('downloads', 'Failed to remove temporary transcode file', error);
        }
        resolve(false);
      });
      proc.on('error', () => {
        signal.removeEventListener('abort', onAbort);
        this.activeProcesses.delete(videoId);
        resolve(false);
      });
    });
  }

  private async ensureYtdlp(signal: AbortSignal): Promise<string | null> {
    const systemBin = findBinaryInPath('yt-dlp');
    if (systemBin) {
      return systemBin;
    }
    const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const localBin = path.join(this.toolsDir, binName);
    if (existsSync(localBin)) {
      return localBin;
    }
    const key = `${process.platform}-${process.arch}`;
    const url = YTDLP_URLS[key];
    if (!url) {
      return null;
    }
    try {
      mkdirSync(this.toolsDir, { recursive: true });
      const response = await fetch(url, { signal });
      if (!response.ok) {
        return null;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength < 10_000) {
        return null;
      }
      const tmp = `${localBin}.tmp`;
      await fsp.writeFile(tmp, bytes, { mode: 0o755 });
      await fsp.rename(tmp, localBin);
      return localBin;
    } catch {
      return null;
    }
  }

  private async exportCookiesFile(videoId: string): Promise<string | null> {
    try {
      const cookies = await this.ytmSession.cookies.get({});
      const lines = ['# Netscape HTTP Cookie File'];
      for (const c of cookies) {
        const domain = c.domain ?? '';
        if (!domain.includes('youtube.com') && !domain.includes('google.com')) {
          continue;
        }
        const hostOnly = !domain.startsWith('.');
        const flag = hostOnly ? 'FALSE' : 'TRUE';
        const cookiePath = c.path ?? '/';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
        const name = c.name.replace(/[\t\r\n]/g, '');
        const value = c.value.replace(/[\t\r\n]/g, '');
        if (name.length > 0) {
          lines.push(`${domain}\t${flag}\t${cookiePath}\t${secure}\t${expiry}\t${name}\t${value}`);
        }
      }
      if (lines.length <= 1) {
        return null;
      }
      mkdirSync(this.toolsDir, { recursive: true });
      const cookieFile = path.join(this.toolsDir, `cookies-${videoId}.txt`);
      await fsp.writeFile(cookieFile, `${lines.join('\n')}\n`, { mode: 0o600 });
      return cookieFile;
    } catch {
      return null;
    }
  }

  private async downloadViaYtdlp(
    videoId: string,
    finalAudioPath: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const ytdlpBin = await this.ensureYtdlp(signal);
    if (!ytdlpBin || isAborted(signal)) {
      return false;
    }
    const cookieFile = await this.exportCookiesFile(videoId);
    try {
      const okWithCookies = await this.runYtdlpProcess(ytdlpBin, videoId, finalAudioPath, cookieFile, signal);
      if (okWithCookies) {
        return true;
      }
      if (cookieFile && !isAborted(signal)) {
        return await this.runYtdlpProcess(ytdlpBin, videoId, finalAudioPath, null, signal);
      }
      return false;
    } finally {
      if (cookieFile && existsSync(cookieFile)) {
        try {
          await fsp.unlink(cookieFile);
        } catch (error) {
          logWarn('downloads', 'Failed to remove temporary cookie file', error);
        }
      }
    }
  }

  private runYtdlpProcess(
    ytdlpBin: string,
    videoId: string,
    finalAudioPath: string,
    cookieFile: string | null,
    signal: AbortSignal,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const ffmpegBin = findBinaryInPath('ffmpeg');
      const outputTemplate = path.join(this.downloadsDir, `${videoId}.%(ext)s`);
      const args = [
        '--no-playlist',
        '--newline',
        '--progress',
        '--no-warnings',
        '--js-runtimes',
        `node:${process.execPath}`,
        '-f',
        'ba[ext=m4a]/ba/b',
      ];
      if (ffmpegBin) {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0', '--ffmpeg-location', ffmpegBin);
      }
      if (cookieFile) {
        args.push('--cookies', cookieFile);
      }
      args.push('-o', outputTemplate, `https://music.youtube.com/watch?v=${videoId}`);

      const proc = spawn(ytdlpBin, args, {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
      });
      this.activeProcesses.set(videoId, proc);

      let lastEmit = 0;
      const onChunk = (chunk: Buffer): void => {
        const text = chunk.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          const progress = parseYtdlpProgress(line);
          if (progress !== null) {
            const now = Date.now();
            if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
              lastEmit = now;
              this.updateItem(videoId, { progress });
            }
          }
        }
      };

      proc.stdout.on('data', onChunk);
      proc.stderr.on('data', onChunk);

      const onAbort = (): void => {
        try {
          proc.kill('SIGKILL');
        } catch (error) {
          logWarn('downloads', 'Failed to kill yt-dlp process', error);
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });

      proc.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        this.activeProcesses.delete(videoId);
        if (code !== 0) {
          resolve(false);
          return;
        }
        if (existsSync(finalAudioPath)) {
          resolve(true);
          return;
        }
        for (const ext of ['m4a', 'webm', 'opus', 'mp4']) {
          const candidate = path.join(this.downloadsDir, `${videoId}.${ext}`);
          if (existsSync(candidate)) {
            try {
              renameSync(candidate, finalAudioPath);
              resolve(true);
              return;
            } catch {
              resolve(false);
              return;
            }
          }
        }
        resolve(false);
      });

      proc.on('error', () => {
        signal.removeEventListener('abort', onAbort);
        this.activeProcesses.delete(videoId);
        resolve(false);
      });
    });
  }
}
