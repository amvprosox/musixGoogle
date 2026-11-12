import { spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { Session, WebContents } from 'electron';
import { isBoundedString, isFiniteNumber, isRecord, isString } from '../shared/guards';
import type {
  DownloadBatchRequest,
  DownloadBatchResult,
  DownloadItem,
  DownloadStatus,
  DownloadTrackRequest,
} from '../shared/types';
import { isVideoId } from '../shared/validators';
import { logError, logWarn } from './log';

const STORE_FILE = 'downloads.json';
const LOG_FILE = 'downloads.log';
const MAX_LOG_LINES = 500;
const MAX_CONCURRENT_DOWNLOADS = 3;
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
  readonly clientId: string;
  readonly ua: string;
  readonly osName?: string;
  readonly osVersion?: string;
  readonly deviceMake?: string;
  readonly deviceModel?: string;
  readonly sdk?: number;
  readonly html5Pref?: boolean;
}

const INNERTUBE_CLIENTS: readonly InnertubeClientSpec[] = [
  {
    name: 'VISIONOS',
    version: '1.02',
    clientId: '101',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    osName: 'visionOS',
    osVersion: '26.5.23O471',
    deviceMake: 'Apple',
    deviceModel: 'RealityDevice17,1',
    html5Pref: true,
  },
  {
    name: 'IOS',
    version: '20.10.4',
    clientId: '5',
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    osName: 'iPhone',
    osVersion: '18.3.2.22D82',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
  },
  {
    name: 'ANDROID',
    version: '20.10.38',
    clientId: '3',
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
    osName: 'Android',
    osVersion: '14',
    sdk: 34,
  },
  {
    name: 'ANDROID_VR',
    version: '1.61.48',
    clientId: '28',
    ua: 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    osName: 'Android',
    osVersion: '12L',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    sdk: 32,
  },
];

interface ResolvedStream {
  readonly clientName: string;
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

function sanitizeTitleForFilename(title: string, videoId: string): string {
  const cleaned = title
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim();
  return cleaned.length > 0 ? cleaned : videoId;
}

function formatTrackDescription(item: {
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  videoId: string;
}): string {
  const lines = [`Title: ${item.title}`];
  if (item.artist) {
    lines.push(`Artist: ${item.artist}`);
  }
  if (item.album) {
    lines.push(`Album: ${item.album}`);
  }
  if (item.durationSec > 0) {
    lines.push(`Duration: ${item.durationSec}s`);
  }
  lines.push(`Video ID: ${item.videoId}`);
  return `${lines.join('\n')}\n`;
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
  readonly musicDir: string;
  readonly thumbnailsDir: string;
  readonly miscDir: string;
  private readonly toolsDir: string;
  private readonly storePath: string;
  private readonly logPath: string;
  private items: DownloadItem[] = [];
  private logs: string[] = [];
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private readonly listeners = new Set<(items: DownloadItem[]) => void>();
  private readonly logListeners = new Set<(logs: string[]) => void>();
  private runningDownloads = 0;
  private logEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly slotWaiters: Array<() => void> = [];
  private cachedVisitorData = '';

  constructor(
    userDataDir: string,
    private readonly ytmSession: Session,
    private readonly getYtmContents: () => WebContents | null,
  ) {
    this.downloadsDir = path.join(userDataDir, 'downloads');
    this.musicDir = path.join(this.downloadsDir, 'music');
    this.thumbnailsDir = path.join(this.downloadsDir, 'thumbnails');
    this.miscDir = path.join(this.downloadsDir, 'misc');
    this.toolsDir = path.join(userDataDir, 'tools');
    this.storePath = path.join(this.miscDir, STORE_FILE);
    this.logPath = path.join(this.miscDir, LOG_FILE);
    this.ensureDirectories();
    this.loadLogs();
    this.load();
  }

  private ensureDirectories(): void {
    mkdirSync(this.musicDir, { recursive: true });
    mkdirSync(this.thumbnailsDir, { recursive: true });
    mkdirSync(this.miscDir, { recursive: true });
  }

  private loadLogs(): void {
    if (!existsSync(this.logPath)) {
      this.logs = [];
      return;
    }
    try {
      const content = readFileSync(this.logPath, 'utf8');
      this.logs = content
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .slice(-MAX_LOG_LINES);
    } catch (error) {
      logWarn('downloads', 'Failed to load downloads.log', error);
      this.logs = [];
    }
  }

  appendLog(message: string): void {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const entry = `${hh}:${mm}:${ss} ${message}`;
    this.logs.push(entry);
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs = this.logs.slice(-MAX_LOG_LINES);
    }
    try {
      this.ensureDirectories();
      appendFileSync(this.logPath, `${entry}\n`, 'utf8');
    } catch (error) {
      logWarn('downloads', 'Failed to append to downloads.log', error);
    }
    this.emitLogs();
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  clearLogs(): boolean {
    this.logs = [];
    try {
      this.ensureDirectories();
      writeFileSync(this.logPath, '', 'utf8');
    } catch (error) {
      logWarn('downloads', 'Failed to clear downloads.log', error);
    }
    this.emitLogs();
    return true;
  }

  onLogsChanged(listener: (logs: string[]) => void): () => void {
    this.logListeners.add(listener);
    return () => {
      this.logListeners.delete(listener);
    };
  }

  private emitLogs(): void {
    if (this.logEmitTimer) {
      return;
    }
    this.logEmitTimer = setTimeout(() => {
      this.logEmitTimer = null;
      const snapshot = this.getLogs();
      for (const listener of this.logListeners) {
        listener(snapshot);
      }
    }, 200);
  }

  private fileStemFor(title: string, videoId: string): string {
    const base = sanitizeTitleForFilename(title, videoId);
    const conflict = this.items.some(
      (other) =>
        other.videoId !== videoId &&
        sanitizeTitleForFilename(other.title, other.videoId).toLowerCase() === base.toLowerCase(),
    );
    return conflict ? `${base} (${videoId})` : base;
  }

  private audioFilePath(title: string, videoId: string): string {
    return path.join(this.musicDir, `${this.fileStemFor(title, videoId)}.mp3`);
  }

  private thumbnailFilePath(title: string, videoId: string): string {
    return path.join(this.thumbnailsDir, `${this.fileStemFor(title, videoId)}.jpg`);
  }

  private descriptionFilePath(title: string, videoId: string): string {
    return path.join(this.miscDir, `${this.fileStemFor(title, videoId)}.txt`);
  }

  private audioAssetUrl(title: string, videoId: string): string {
    return `musix-asset://downloads/music/${encodeURIComponent(`${this.fileStemFor(title, videoId)}.mp3`)}`;
  }

  private thumbnailAssetUrl(title: string, videoId: string): string {
    return `musix-asset://downloads/thumbnails/${encodeURIComponent(`${this.fileStemFor(title, videoId)}.jpg`)}`;
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
    if (this.logEmitTimer) {
      clearTimeout(this.logEmitTimer);
      this.logEmitTimer = null;
    }
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

  private isCompletedOnDisk(existing: DownloadItem | undefined): boolean {
    if (!existing || existing.status !== 'completed') {
      return false;
    }
    return existsSync(this.audioFilePath(existing.title, existing.videoId));
  }

  startDownload(track: DownloadTrackRequest): DownloadItem {
    const existing = this.items.find((item) => item.videoId === track.videoId);
    if (existing) {
      if (this.isCompletedOnDisk(existing)) {
        this.appendLog(`Skipped "${track.title}" (${track.videoId}) - already downloaded`);
        return { ...existing };
      }
      if (existing.status === 'downloading') {
        this.appendLog(`"${track.title}" (${track.videoId}) is already downloading`);
        return { ...existing };
      }
    }

    const [item] = this.queueTracks([track]);
    return item ? { ...item } : this.newItem(track, Date.now());
  }

  private newItem(track: DownloadTrackRequest, createdAt: number): DownloadItem {
    return {
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
      createdAt,
    };
  }

  private queueTracks(tracks: DownloadTrackRequest[]): DownloadItem[] {
    if (tracks.length === 0) {
      return [];
    }
    const now = Date.now();
    const newItems = tracks.map((track, index) => this.newItem(track, now - index));
    const newIds = new Set(newItems.map((entry) => entry.videoId));
    this.items = [...newItems, ...this.items.filter((entry) => !newIds.has(entry.videoId))];
    this.persist();
    this.emit();
    for (const item of newItems) {
      this.activeControllers.get(item.videoId)?.abort();
      const controller = new AbortController();
      this.activeControllers.set(item.videoId, controller);
      this.appendLog(`Queued download: "${item.title}" (${item.videoId})`);
      void this.runQueued(item, controller.signal);
    }
    return newItems;
  }

  private acquireSlot(signal: AbortSignal): Promise<boolean> {
    if (isAborted(signal)) {
      return Promise.resolve(false);
    }
    if (this.runningDownloads < MAX_CONCURRENT_DOWNLOADS) {
      this.runningDownloads += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const onAbort = (): void => {
        const idx = this.slotWaiters.indexOf(waiter);
        if (idx !== -1) {
          this.slotWaiters.splice(idx, 1);
        }
        resolve(false);
      };
      const waiter = (): void => {
        signal.removeEventListener('abort', onAbort);
        resolve(true);
      };
      this.slotWaiters.push(waiter);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private releaseSlot(): void {
    const next = this.slotWaiters.shift();
    if (next) {
      next();
      return;
    }
    this.runningDownloads = Math.max(0, this.runningDownloads - 1);
  }

  private async runQueued(item: DownloadItem, signal: AbortSignal): Promise<void> {
    const acquired = await this.acquireSlot(signal);
    if (!acquired) {
      return;
    }
    try {
      if (isAborted(signal)) {
        return;
      }
      this.updateItem(item.videoId, { progress: 0.01 });
      this.appendLog(`Start download: "${item.title}" (${item.videoId})`);
      await this.runDownload(item, signal);
    } finally {
      this.releaseSlot();
    }
  }

  downloadBatch(request: DownloadBatchRequest): DownloadBatchResult {
    const label = request.title.trim() || 'Library';
    let skipped = 0;
    const seen = new Set<string>();
    const uniqueTracks = request.tracks.filter((t) => {
      if (!isVideoId(t.videoId) || seen.has(t.videoId)) {
        return false;
      }
      seen.add(t.videoId);
      return true;
    });

    const existingById = new Map(this.items.map((item) => [item.videoId, item]));
    const toQueue: DownloadTrackRequest[] = [];
    for (const track of uniqueTracks) {
      const existing = existingById.get(track.videoId);
      const active = existing?.status === 'downloading' && this.activeControllers.has(track.videoId);
      if (this.isCompletedOnDisk(existing) || active) {
        skipped += 1;
        this.appendLog(`[${label}] Skipped "${track.title}" (${track.videoId}) - already downloaded`);
      } else {
        toQueue.push(track);
      }
    }
    this.queueTracks(toQueue);
    const started = toQueue.length;

    const total = uniqueTracks.length;
    const alreadyDownloaded = total > 0 && started === 0;
    if (alreadyDownloaded) {
      this.appendLog(`[${label}] All ${total} track(s) already downloaded`);
    } else {
      this.appendLog(`[${label}] Queued ${started} track(s), skipped ${skipped} already downloaded`);
    }
    return {
      started,
      skipped,
      total,
      alreadyDownloaded,
    };
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

    const target = this.items.find((item) => item.videoId === videoId);
    const stem = target ? this.fileStemFor(target.title, videoId) : videoId;

    const before = this.items.length;
    this.items = this.items.filter((item) => item.videoId !== videoId);
    this.persist();
    this.emit();
    if (target) {
      this.appendLog(`Deleted download: "${target.title}" (${videoId})`);
    }

    const candidates = [
      path.join(this.musicDir, `${stem}.mp3`),
      path.join(this.thumbnailsDir, `${stem}.jpg`),
      path.join(this.miscDir, `${stem}.txt`),
      path.join(this.miscDir, `${videoId}.part`),
      path.join(this.miscDir, `${videoId}.raw`),
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
    this.ensureDirectories();
    const legacyStore = path.join(this.downloadsDir, STORE_FILE);
    if (!existsSync(this.storePath) && existsSync(legacyStore)) {
      try {
        renameSync(legacyStore, this.storePath);
      } catch (error) {
        logWarn('downloads', 'Failed to migrate legacy downloads.json', error);
      }
    }
    this.cleanStaleTempFiles();
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
      this.migrateItemFiles();
      this.persist();
    } catch (error) {
      logError('downloads', 'Failed to read downloads.json', error);
      this.items = [];
    }
  }

  private cleanStaleTempFiles(): void {
    for (const dir of [this.downloadsDir, this.miscDir]) {
      try {
        for (const name of readdirSync(dir)) {
          if (name.endsWith('.raw') || name.endsWith('.part') || name.endsWith('.part.mp3')) {
            rmSync(path.join(dir, name), { force: true });
          }
        }
      } catch (error) {
        logWarn('downloads', 'Failed to clean temp files', error);
      }
    }
  }

  private migrateItemFiles(): void {
    for (let i = 0; i < this.items.length; i += 1) {
      const item = this.items[i];
      if (!item) {
        continue;
      }
      const newAudio = this.audioFilePath(item.title, item.videoId);
      const oldAudio = path.join(this.downloadsDir, `${item.videoId}.mp3`);
      if (!existsSync(newAudio) && existsSync(oldAudio)) {
        try {
          renameSync(oldAudio, newAudio);
        } catch (error) {
          logWarn('downloads', 'Failed to migrate audio file', error);
        }
      }
      const newThumb = this.thumbnailFilePath(item.title, item.videoId);
      const oldThumb = path.join(this.downloadsDir, `${item.videoId}.jpg`);
      if (!existsSync(newThumb) && existsSync(oldThumb)) {
        try {
          renameSync(oldThumb, newThumb);
        } catch (error) {
          logWarn('downloads', 'Failed to migrate thumbnail file', error);
        }
      }
      const descPath = this.descriptionFilePath(item.title, item.videoId);
      if (!existsSync(descPath)) {
        try {
          writeFileSync(descPath, formatTrackDescription(item), 'utf8');
        } catch (error) {
          logWarn('downloads', 'Failed to write description file', error);
        }
      }
      let nextArtwork = item.artworkUrl;
      if (existsSync(newThumb)) {
        nextArtwork = this.thumbnailAssetUrl(item.title, item.videoId);
      }
      let nextAudio = item.audioUrl;
      if (item.status === 'completed' && existsSync(newAudio)) {
        nextAudio = this.audioAssetUrl(item.title, item.videoId);
      }
      this.items[i] = {
        ...item,
        artworkUrl: nextArtwork,
        audioUrl: nextAudio,
      };
    }
  }

  private persist(): void {
    try {
      this.ensureDirectories();
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
    const { videoId, title } = item;
    this.ensureDirectories();
    const finalAudioPath = this.audioFilePath(title, videoId);
    const descPath = this.descriptionFilePath(title, videoId);
    try {
      await fsp.writeFile(descPath, formatTrackDescription(item), 'utf8');
      const localArtwork = await this.downloadThumbnail(title, videoId, item.artworkUrl, signal);
      if (isAborted(signal)) {
        return;
      }
      if (localArtwork) {
        this.updateItem(videoId, { artworkUrl: localArtwork }, true);
        this.appendLog(`[${videoId}] Saved thumbnail: thumbnails/${this.fileStemFor(title, videoId)}.jpg`);
      }

      let downloaded = false;
      try {
        downloaded = await this.downloadViaDirectStream(videoId, finalAudioPath, signal);
      } catch (streamErr) {
        const reason = streamErr instanceof Error ? streamErr.message : 'stream error';
        this.appendLog(`[${videoId}] Direct stream failed (${reason}), trying yt-dlp fallback`);
        logWarn('downloads', 'Direct stream download failed, trying yt-dlp fallback', streamErr);
      }

      if (!downloaded && !isAborted(signal)) {
        this.appendLog(`[${videoId}] Starting yt-dlp fallback`);
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
          audioUrl: this.audioAssetUrl(title, videoId),
          status: 'completed',
          progress: 1,
          error: null,
        },
        true,
      );
      this.appendLog(`[${videoId}] Completed MP3: music/${this.fileStemFor(title, videoId)}.mp3`);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Download failed';
      this.appendLog(`[${videoId}] ERROR: ${message}`);
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
    title: string,
    videoId: string,
    artworkUrl: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const urls = [upgradeArtworkUrl(artworkUrl, videoId), `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`];
    const dest = this.thumbnailFilePath(title, videoId);
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
        return this.thumbnailAssetUrl(title, videoId);
      } catch {
        if (signal.aborted) {
          return null;
        }
      }
    }
    return null;
  }

  private async resolveVisitorData(signal: AbortSignal): Promise<string> {
    if (this.cachedVisitorData.length > 10) {
      return this.cachedVisitorData;
    }
    try {
      const swResp = await fetch('https://www.youtube.com/sw.js_data', {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
        },
        signal,
      });
      if (swResp.ok) {
        const raw = await swResp.text();
        const match = /"(Cgt[A-Za-z0-9_%-]+)"/.exec(raw);
        if (match && match[1]) {
          this.cachedVisitorData = match[1];
          return match[1];
        }
      }
    } catch (error) {
      logWarn('downloads', 'Failed to fetch sw.js_data visitor token', error);
    }
    try {
      const response = await fetch('https://www.youtube.com/', {
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
    return '';
  }

  private async resolveDirectAudioStreams(videoId: string, signal: AbortSignal): Promise<ResolvedStream[]> {
    const visitorData = await this.resolveVisitorData(signal);
    const streams: ResolvedStream[] = [];
    for (const client of INNERTUBE_CLIENTS) {
      if (signal.aborted) {
        return streams;
      }
      try {
        const clientContext: Record<string, unknown> = {
          clientName: client.name,
          clientVersion: client.version,
          userAgent: client.ua,
          hl: 'en',
          gl: 'US',
          timeZone: 'UTC',
          utcOffsetMinutes: 0,
        };
        if (client.osName) {
          clientContext.osName = client.osName;
        }
        if (client.osVersion) {
          clientContext.osVersion = client.osVersion;
        }
        if (client.deviceMake) {
          clientContext.deviceMake = client.deviceMake;
        }
        if (client.deviceModel) {
          clientContext.deviceModel = client.deviceModel;
        }
        if (client.sdk) {
          clientContext.androidSdkVersion = client.sdk;
        }
        if (visitorData) {
          clientContext.visitorData = visitorData;
        }
        const body: Record<string, unknown> = {
          videoId,
          context: { client: clientContext },
          contentCheckOk: true,
          racyCheckOk: true,
        };
        if (client.html5Pref) {
          body.playbackContext = {
            contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' },
          };
        }
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': client.ua,
          'X-YouTube-Client-Name': client.clientId,
          'X-YouTube-Client-Version': client.version,
          Origin: 'https://www.youtube.com',
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
          this.appendLog(`[${videoId}] Client ${client.name} HTTP ${response.status}`);
          continue;
        }
        const data: unknown = await response.json();
        if (!isRecord(data)) {
          continue;
        }
        const playStatus =
          isRecord(data.playabilityStatus) && isString(data.playabilityStatus.status)
            ? data.playabilityStatus.status
            : 'UNKNOWN';
        if (!isRecord(data.streamingData)) {
          this.appendLog(`[${videoId}] Client ${client.name} playability=${playStatus} (no streamingData)`);
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
          this.appendLog(
            `[${videoId}] Client ${client.name} resolved audio stream (${best.contentLength} bytes)`,
          );
          streams.push({
            clientName: client.name,
            url: best.url,
            contentLength:
              Number.isFinite(best.contentLength) && best.contentLength > 0 ? best.contentLength : 0,
            userAgent: client.ua,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'error';
        this.appendLog(`[${videoId}] Client ${client.name} failed: ${msg}`);
        if (isAborted(signal)) {
          return streams;
        }
      }
    }
    return streams;
  }

  private async downloadViaDirectStream(
    videoId: string,
    finalAudioPath: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const streams = await this.resolveDirectAudioStreams(videoId, signal);
    if (streams.length === 0) {
      return false;
    }
    const rawPath = path.join(this.miscDir, `${videoId}.raw`);
    try {
      for (const resolved of streams) {
        if (isAborted(signal)) {
          return false;
        }
        const ok = await this.downloadSingleStream(videoId, resolved, rawPath, signal);
        if (ok && existsSync(rawPath)) {
          const ffmpegBin = findBinaryInPath('ffmpeg');
          if (ffmpegBin && !signal.aborted) {
            const converted = await this.transcodeToMp3(videoId, ffmpegBin, rawPath, finalAudioPath, signal);
            if (converted && existsSync(finalAudioPath)) {
              return true;
            }
          }
          await fsp.rename(rawPath, finalAudioPath);
          return existsSync(finalAudioPath);
        }
      }
      return false;
    } finally {
      try {
        if (existsSync(rawPath)) {
          await fsp.unlink(rawPath);
        }
      } catch (error) {
        logWarn('downloads', 'Failed to remove raw file', error);
      }
    }
  }

  private async downloadSingleStream(
    videoId: string,
    resolved: ResolvedStream,
    rawPath: string,
    signal: AbortSignal,
  ): Promise<boolean> {
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
        this.appendLog(`[${videoId}] ${resolved.clientName} stream HTTP ${response.status}`);
        return false;
      }
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.byteLength === 0) {
        return false;
      }
      await fsp.writeFile(rawPath, buf);
      return true;
    }

    while (downloadedBytes < totalBytes) {
      if (isAborted(signal)) {
        return false;
      }
      const end = Math.min(downloadedBytes + CHUNK_SIZE - 1, totalBytes - 1);
      let chunkBuf: Buffer | null = null;
      let lastStatus = 0;
      for (let attempt = 0; attempt < Math.min(urls.length, 4); attempt += 1) {
        const targetUrl = urls[(urlIndex + attempt) % urls.length] ?? resolved.url;
        try {
          const response = await fetch(targetUrl, {
            headers: {
              'User-Agent': resolved.userAgent,
              Range: `bytes=${downloadedBytes}-${end}`,
            },
            signal,
          });
          lastStatus = response.status;
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
        this.appendLog(
          `[${videoId}] ${resolved.clientName} chunk HTTP ${lastStatus} at byte ${downloadedBytes}/${totalBytes}`,
        );
        return false;
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
    return true;
  }

  private transcodeToMp3(
    videoId: string,
    ffmpegBin: string,
    inputPath: string,
    outputPath: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const tmpOut = path.join(this.miscDir, `${videoId}.part.mp3`);
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
      const outputTemplate = path.join(this.miscDir, `${videoId}.%(ext)s`);
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
        for (const ext of ['mp3', 'm4a', 'webm', 'opus', 'mp4']) {
          const candidate = path.join(this.miscDir, `${videoId}.${ext}`);
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
