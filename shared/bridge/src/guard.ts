import { clickFirst, DOC_SEL, queryFirst } from './dom';

export const GESTURE_WINDOW_MS = 1500;
export const HIDDEN_PAUSE_WINDOW_MS = 3000;
export const RESUME_DELAYS_MS: readonly number[] = [250, 900, 2000, 4000];
export const ACTIVITY_INTERVAL_MS = 60_000;

export interface GuardMedia {
  video: () => HTMLVideoElement | null;
  isAd: () => boolean;
  resume: () => void;
}

export class PlaybackGuard {
  private wantsPlay = false;
  private lastGestureAt = Number.NEGATIVE_INFINITY;
  private lastPauseCommandAt = Number.NEGATIVE_INFINITY;
  private hiddenAt = Number.NEGATIVE_INFINITY;
  private pausedAt = Number.NEGATIVE_INFINITY;
  private attempt = 0;
  private timer: number | null = null;
  private activityTimer: number | null = null;
  private videoAbort: AbortController | null = null;
  private readonly abort = new AbortController();
  private attached: HTMLVideoElement | null = null;

  constructor(
    private readonly doc: Document,
    private readonly win: Window,
    private readonly media: GuardMedia,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(): void {
    const signal = this.abort.signal;
    const gesture = (event: Event): void => {
      if (event.isTrusted) {
        this.lastGestureAt = this.now();
      }
    };
    for (const name of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) {
      this.win.addEventListener(name, gesture, { capture: true, passive: true, signal });
    }
    this.doc.addEventListener(
      'visibilitychange',
      () => {
        if (this.doc.visibilityState === 'hidden') {
          this.hiddenAt = this.now();
          this.considerResume();
        }
      },
      { capture: true, passive: true, signal },
    );
    this.activityTimer = this.win.setInterval(() => {
      this.keepActive();
    }, ACTIVITY_INTERVAL_MS);
  }

  stop(): void {
    this.abort.abort();
    this.videoAbort?.abort();
    this.clearTimer();
    if (this.activityTimer !== null) {
      this.win.clearInterval(this.activityTimer);
      this.activityTimer = null;
    }
  }

  wantsPlayback(): boolean {
    return this.wantsPlay;
  }

  commanded(play: boolean): void {
    this.wantsPlay = play;
    if (!play) {
      this.lastPauseCommandAt = this.now();
    }
    this.attempt = 0;
    this.clearTimer();
  }

  attach(video: HTMLVideoElement | null): void {
    if (video === this.attached) {
      return;
    }
    this.videoAbort?.abort();
    this.attached = video;
    if (!video) {
      return;
    }
    const controller = new AbortController();
    this.videoAbort = controller;
    const options = { signal: controller.signal, passive: true };
    video.addEventListener(
      'play',
      () => {
        this.wantsPlay = true;
        this.attempt = 0;
        this.clearTimer();
      },
      options,
    );
    video.addEventListener(
      'pause',
      () => {
        this.onPause();
      },
      options,
    );
  }

  youThereDialog(): Element | null {
    const dialog = queryFirst(this.doc, DOC_SEL.youThere);
    if (!dialog || !dialog.isConnected || !this.isShown(dialog)) {
      return null;
    }
    return dialog;
  }

  private isShown(element: Element): boolean {
    const visible = element as Element & { checkVisibility?: unknown };
    if (typeof visible.checkVisibility === 'function') {
      return (element as Element & { checkVisibility: () => boolean }).checkVisibility();
    }
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') {
        return false;
      }
      if (this.win.getComputedStyle(node).display === 'none') {
        return false;
      }
    }
    return true;
  }

  dismissYouThere(): boolean {
    const dialog = this.youThereDialog();
    if (!dialog) {
      return false;
    }
    clickFirst(dialog, DOC_SEL.youThereConfirm);
    this.markActive();
    return true;
  }

  check(): void {
    if (this.wantsPlay && this.youThereDialog()) {
      this.dismissYouThere();
      this.considerResume();
    }
  }

  private onPause(): void {
    const at = this.now();
    this.pausedAt = at;
    const video = this.attached;
    if (video && video.ended) {
      return;
    }
    if (at - this.lastGestureAt < GESTURE_WINDOW_MS) {
      this.wantsPlay = false;
      return;
    }
    this.considerResume();
  }

  private shouldResume(): boolean {
    const video = this.attached;
    if (!this.wantsPlay || !video || !video.paused || video.ended || this.media.isAd()) {
      return false;
    }
    if (this.pausedAt - this.lastGestureAt < GESTURE_WINDOW_MS) {
      return false;
    }
    if (this.pausedAt - this.lastPauseCommandAt < GESTURE_WINDOW_MS) {
      return false;
    }
    if (this.youThereDialog()) {
      return true;
    }
    return Math.abs(this.pausedAt - this.hiddenAt) < HIDDEN_PAUSE_WINDOW_MS;
  }

  private considerResume(): void {
    if (this.timer !== null || !this.shouldResume()) {
      return;
    }
    const delay = RESUME_DELAYS_MS[this.attempt];
    if (delay === undefined) {
      return;
    }
    this.timer = this.win.setTimeout(() => {
      this.timer = null;
      if (!this.shouldResume()) {
        return;
      }
      this.attempt += 1;
      this.dismissYouThere();
      this.media.resume();
      this.considerResume();
    }, delay);
  }

  private keepActive(): void {
    if (this.wantsPlay) {
      this.markActive();
    }
    this.check();
  }

  private markActive(): void {
    const target = this.win as unknown as { _lact?: unknown };
    if (typeof target._lact === 'number' || target._lact === undefined) {
      target._lact = this.now();
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.win.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
