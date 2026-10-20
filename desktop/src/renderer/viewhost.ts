import type { ShellApi } from '../shared/channels';
import type { Rect } from '../shared/types';
import type { ShellState, Store } from './state';

export function baseViewVisible(state: ShellState): boolean {
  return (
    state.initialized &&
    !state.settingsOpen &&
    state.viewStatus.kind === 'ready' &&
    state.online &&
    !state.nowPlayingOpen &&
    !state.searchOverlayOpen &&
    !(state.layout.queueMode === 'sheet' && state.queueOpen)
  );
}

export class ViewHost {
  private readonly leases = new Set<string>();
  private capturing = 0;
  private lastSent = '';
  private frameRequested = false;
  private readonly observer: ResizeObserver;

  constructor(
    private readonly store: Store,
    private readonly api: ShellApi,
    private readonly host: HTMLElement,
    private readonly freezeImg: HTMLImageElement,
  ) {
    this.observer = new ResizeObserver(() => {
      this.sync();
    });
    this.observer.observe(host);
    window.addEventListener('resize', () => {
      this.sync();
    });
    store.subscribe(() => {
      this.sync();
      this.syncNextFrame();
    });
    document.addEventListener('transitionend', () => {
      this.sync();
    });
    document.addEventListener('transitionrun', () => {
      this.trackTransition();
    });
  }

  private trackingUntil = 0;

  private trackTransition(): void {
    this.trackingUntil = performance.now() + 400;
    const tick = (): void => {
      this.sync();
      if (performance.now() < this.trackingUntil) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }

  private syncNextFrame(): void {
    if (this.frameRequested) {
      return;
    }
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.sync();
    });
  }

  isFrozen(): boolean {
    return this.leases.size > 0 && this.capturing === 0;
  }

  visible(): boolean {
    return baseViewVisible(this.store.getState()) && !this.isFrozen();
  }

  measure(): Rect {
    const rect = this.host.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  sync(): void {
    const bounds = this.measure();
    const visible = this.visible();
    const key = `${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}:${visible}`;
    if (key === this.lastSent) {
      return;
    }
    this.lastSent = key;
    this.api.send('view:layout', { bounds, visible });
  }

  private leaseCount(): number {
    return this.leases.size;
  }

  hasLease(id: string): boolean {
    return this.leases.has(id);
  }

  async acquire(id: string): Promise<void> {
    if (this.leases.has(id)) {
      return;
    }
    const needsCapture = this.leaseCount() === 0 && this.visible();
    this.leases.add(id);
    if (!needsCapture) {
      this.sync();
      return;
    }
    this.capturing += 1;
    try {
      const url = await this.api.invoke('view:freeze', null);
      if (url && this.leaseCount() > 0) {
        this.freezeImg.src = url;
        try {
          await this.freezeImg.decode();
        } catch (error) {
          console.warn('[viewhost] freeze frame decode failed', error);
        }
        this.freezeImg.hidden = false;
      }
    } catch (error) {
      console.warn('[viewhost] freeze failed', error);
    } finally {
      this.capturing -= 1;
      this.sync();
    }
  }

  release(id: string): void {
    if (!this.leases.delete(id)) {
      return;
    }
    if (this.leases.size > 0) {
      return;
    }
    this.sync();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.leases.size === 0) {
          this.freezeImg.hidden = true;
          this.freezeImg.removeAttribute('src');
        }
      });
    });
  }
}
