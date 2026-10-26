import { clickFirst, DOC_SEL, queryFirst } from './dom';

export const ACTIVITY_INTERVAL_MS = 60_000;
export const TRACK_CHANGE_WINDOW_MS = 3000;
export const PROMPT_RESUME_DELAY_MS = 1000;

export interface GuardMedia {
  resume: () => void;
}

export class PlaybackGuard {
  private wantsPlay = false;
  private loadedAt = Number.NEGATIVE_INFINITY;
  private activityTimer: number | null = null;
  private resumeTimer: number | null = null;
  private videoAbort: AbortController | null = null;
  private attached: HTMLVideoElement | null = null;

  constructor(
    private readonly doc: Document,
    private readonly win: Window,
    private readonly media: GuardMedia,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(): void {
    this.activityTimer = this.win.setInterval(() => {
      this.keepActive();
    }, ACTIVITY_INTERVAL_MS);
  }

  stop(): void {
    this.videoAbort?.abort();
    if (this.activityTimer !== null) {
      this.win.clearInterval(this.activityTimer);
      this.activityTimer = null;
    }
    if (this.resumeTimer !== null) {
      this.win.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  commanded(play: boolean): void {
    this.wantsPlay = play;
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
      },
      options,
    );
    for (const name of ['emptied', 'loadstart']) {
      video.addEventListener(
        name,
        () => {
          this.loadedAt = this.now();
        },
        options,
      );
    }
  }

  isLoading(): boolean {
    const video = this.attached;
    if (!video) {
      return false;
    }
    return (video.readyState === 0 && !video.paused) || this.now() - this.loadedAt < TRACK_CHANGE_WINDOW_MS;
  }

  youThereDialog(): Element | null {
    const dialog = queryFirst(this.doc, DOC_SEL.youThere);
    if (!dialog || !dialog.isConnected || !this.isShown(dialog)) {
      return null;
    }
    return dialog;
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
    if (!this.wantsPlay || !this.dismissYouThere() || this.resumeTimer !== null) {
      return;
    }
    this.resumeTimer = this.win.setTimeout(() => {
      this.resumeTimer = null;
      const video = this.attached;
      if (this.wantsPlay && video && video.paused && !video.ended) {
        this.media.resume();
      }
    }, PROMPT_RESUME_DELAY_MS);
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
}
