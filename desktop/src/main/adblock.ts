import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { net, type Session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ADBLOCK_CACHE_FILE, ADBLOCK_REFRESH_MS } from '../shared/constants';
import { errorMessage } from '../shared/guards';
import type { AdblockStatus } from '../shared/types';
import { logError, logInfo, logWarn } from './log';

type StatusListener = (status: AdblockStatus) => void;

async function fetchLists(url: string): Promise<Response> {
  return net.fetch(url, { cache: 'no-store' });
}

export class AdblockManager {
  private blocker: ElectronBlocker | null = null;
  private enabled: boolean;
  private blockedCount = 0;
  private lastUpdated: number | null = null;
  private updating = false;
  private lastError: string | null = null;
  private refreshPromise: Promise<AdblockStatus> | null = null;
  private readonly listeners = new Set<StatusListener>();
  private readonly cachePath: string;

  constructor(
    private readonly session: Session,
    userDataDir: string,
    enabled: boolean,
  ) {
    this.enabled = enabled;
    this.cachePath = path.join(userDataDir, ADBLOCK_CACHE_FILE);
  }

  status(): AdblockStatus {
    return {
      enabled: this.enabled,
      ready: this.blocker !== null,
      blockedCount: this.blockedCount,
      lastUpdated: this.lastUpdated,
      updating: this.updating,
      lastError: this.lastError,
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.status();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        logError('adblock', 'Status listener failed', error);
      }
    }
  }

  async init(): Promise<void> {
    const cached = await this.loadCache();
    if (cached) {
      this.install(cached.engine);
      this.lastUpdated = cached.mtime;
      this.emit();
      if (this.isStale()) {
        this.refresh().catch((error: unknown) => {
          logWarn('adblock', 'Background refresh failed', error);
        });
      }
      return;
    }
    await this.refresh();
  }

  isStale(now: number = Date.now()): boolean {
    if (this.lastUpdated === null) {
      return true;
    }
    return now - this.lastUpdated >= ADBLOCK_REFRESH_MS;
  }

  private async loadCache(): Promise<{ engine: ElectronBlocker; mtime: number } | null> {
    try {
      const [buffer, stats] = await Promise.all([fs.readFile(this.cachePath), fs.stat(this.cachePath)]);
      const engine = ElectronBlocker.deserialize(new Uint8Array(buffer));
      return { engine, mtime: stats.mtimeMs };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logWarn('adblock', 'Cached engine unreadable, fetching fresh lists', error);
      }
      return null;
    }
  }

  private async writeCache(engine: ElectronBlocker): Promise<number> {
    const tmp = `${this.cachePath}.tmp`;
    await fs.writeFile(tmp, engine.serialize());
    await fs.rename(tmp, this.cachePath);
    const stats = await fs.stat(this.cachePath);
    return stats.mtimeMs;
  }

  refresh(): Promise<AdblockStatus> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.updating = true;
    this.emit();
    this.refreshPromise = (async (): Promise<AdblockStatus> => {
      try {
        const engine = await ElectronBlocker.fromPrebuiltFull(fetchLists);
        this.install(engine);
        try {
          this.lastUpdated = await this.writeCache(engine);
        } catch (error) {
          logWarn('adblock', 'Could not write engine cache', error);
          this.lastUpdated = Date.now();
        }
        this.lastError = null;
        logInfo('adblock', 'Filter lists updated');
      } catch (error) {
        this.lastError = errorMessage(error);
        logError('adblock', 'Filter list update failed, keeping current engine', error);
      } finally {
        this.updating = false;
        this.refreshPromise = null;
        this.emit();
      }
      return this.status();
    })();
    return this.refreshPromise;
  }

  private install(engine: ElectronBlocker): void {
    const previous = this.blocker;
    if (previous && this.enabled) {
      this.detach(previous);
    }
    engine.on('request-blocked', () => {
      this.countBlocked(engine);
    });
    engine.on('request-redirected', () => {
      this.countBlocked(engine);
    });
    this.blocker = engine;
    if (this.enabled) {
      this.attach(engine);
    }
  }

  private countBlocked(engine: ElectronBlocker): void {
    if (engine !== this.blocker || !this.enabled) {
      return;
    }
    this.blockedCount += 1;
    this.scheduleCountEmit();
  }

  private countTimer: NodeJS.Timeout | null = null;

  private scheduleCountEmit(): void {
    if (this.countTimer) {
      return;
    }
    this.countTimer = setTimeout(() => {
      this.countTimer = null;
      this.emit();
    }, 250);
  }

  private attach(engine: ElectronBlocker): void {
    try {
      if (!engine.isBlockingEnabled(this.session)) {
        engine.enableBlockingInSession(this.session);
      }
    } catch (error) {
      logError('adblock', 'Failed to enable blocking', error);
    }
  }

  private detach(engine: ElectronBlocker): void {
    try {
      if (engine.isBlockingEnabled(this.session)) {
        engine.disableBlockingInSession(this.session);
      }
    } catch (error) {
      logError('adblock', 'Failed to disable blocking', error);
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    const engine = this.blocker;
    if (engine) {
      if (enabled) {
        this.attach(engine);
      } else {
        this.detach(engine);
      }
    }
    this.emit();
  }

  dispose(): void {
    if (this.countTimer) {
      clearTimeout(this.countTimer);
      this.countTimer = null;
    }
    const engine = this.blocker;
    if (engine && this.enabled) {
      this.detach(engine);
    }
    this.listeners.clear();
  }
}
