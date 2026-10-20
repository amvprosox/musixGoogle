import { nativeImage, Notification, type BrowserWindow, type Session } from 'electron';
import { shouldNotifyTrackChange } from '../shared/policies';
import type { PlayerState } from '../shared/types';
import { logWarn } from './log';

const ART_TIMEOUT_MS = 4000;
const SETTLE_MS = 1200;

export class TrackNotifier {
  private previous: PlayerState | null = null;
  private current: Notification | null = null;
  private sequence = 0;
  private latest: PlayerState | null = null;
  private settleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly ses: Session,
    private readonly enabled: () => boolean,
  ) {}

  handle(next: PlayerState): void {
    this.latest = next;
    const prev = this.previous;
    if (!next.isAd) {
      this.previous = next;
    }
    const notify = shouldNotifyTrackChange({
      enabled: this.enabled(),
      windowFocused: this.windowFocused(),
      prev,
      next,
    });
    if (!notify) {
      return;
    }
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
    }
    const videoId = next.videoId;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      const settled = this.latest;
      if (!settled || settled.isAd || !settled.hasTrack || settled.title === '') {
        return;
      }
      if (videoId !== '' && settled.videoId !== videoId) {
        return;
      }
      if (!this.enabled() || this.windowFocused()) {
        return;
      }
      this.show(settled).catch((error: unknown) => {
        logWarn('notify', 'Notification failed', error);
      });
    }, SETTLE_MS);
  }

  private windowFocused(): boolean {
    return !this.win.isDestroyed() && this.win.isVisible() && this.win.isFocused();
  }

  private async fetchArtwork(url: string): Promise<Electron.NativeImage | null> {
    if (!url.startsWith('https://')) {
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, ART_TIMEOUT_MS);
    try {
      const response = await this.ses.fetch(url, { signal: controller.signal });
      if (!response.ok) {
        return null;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty()) {
        return null;
      }
      return image.resize({ width: 256, height: 256, quality: 'good' });
    } catch (error) {
      logWarn('notify', 'Artwork fetch failed', error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async show(state: PlayerState): Promise<void> {
    if (!Notification.isSupported()) {
      return;
    }
    this.sequence += 1;
    const sequence = this.sequence;
    const icon = await this.fetchArtwork(state.artworkUrl);
    if (sequence !== this.sequence) {
      return;
    }
    const body = [state.artist, state.album].filter((part) => part !== '').join(' - ');
    if (this.current) {
      this.current.close();
    }
    const notification = new Notification({
      title: state.title,
      body,
      silent: true,
      ...(icon ? { icon } : {}),
    });
    this.current = notification;
    notification.show();
  }

  dispose(): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    if (this.current) {
      this.current.close();
      this.current = null;
    }
  }
}
