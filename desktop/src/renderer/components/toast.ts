import type { ShellApi } from '../../shared/channels';
import { TOAST_DURATION_MS } from '../../shared/constants';
import type { ToastItem, ToastVariant } from '../../shared/types';

export interface ToastInput {
  variant: ToastVariant;
  title: string;
  message?: string;
}

const MAX_TOASTS = 4;

export class ToastController {
  private toasts: ToastItem[] = [];
  private readonly timers = new Map<string, number>();
  private counter = 0;

  constructor(
    private readonly api: ShellApi,
    private readonly liveRegion: HTMLElement | null,
    private readonly bottomOffset: () => number,
  ) {
    api.on('toast:dismiss', (id) => {
      this.dismiss(id);
    });
    window.addEventListener('resize', () => {
      this.publish();
    });
  }

  show(input: ToastInput): string {
    this.counter += 1;
    const id = `t${Date.now().toString(36)}${this.counter}`;
    const toast: ToastItem = {
      id,
      variant: input.variant,
      title: input.title.slice(0, 200),
      message: (input.message ?? '').slice(0, 500),
    };
    this.toasts = [...this.toasts, toast].slice(-MAX_TOASTS);
    const timer = window.setTimeout(() => {
      this.dismiss(id);
    }, TOAST_DURATION_MS);
    this.timers.set(id, timer);
    if (this.liveRegion) {
      this.liveRegion.textContent = toast.message === '' ? toast.title : `${toast.title}. ${toast.message}`;
    }
    this.publish();
    return id;
  }

  dismiss(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(id);
    }
    const next = this.toasts.filter((toast) => toast.id !== id);
    if (next.length === this.toasts.length) {
      return;
    }
    this.toasts = next;
    this.publish();
  }

  current(): readonly ToastItem[] {
    return this.toasts;
  }

  publish(): void {
    this.api.send('overlay:toasts', {
      toasts: this.toasts,
      right: 16,
      bottom: Math.max(0, Math.round(this.bottomOffset())) + 16,
    });
  }
}
