import type { Action, ShellState, Store } from './state';
import { trapFocus } from './focus';
import type { ViewHost } from './viewhost';

export type OverlayId = 'modal' | 'volume' | 'search' | 'nowplaying' | 'queue' | 'sidebar';

const ESC_ORDER: readonly OverlayId[] = ['modal', 'volume', 'search', 'nowplaying', 'queue', 'sidebar'];

const CONTAINERS: Readonly<Record<OverlayId, string>> = {
  modal: '#modal-root .modal',
  volume: '#volume-popover',
  search: '#search-overlay',
  nowplaying: '#nowplaying',
  queue: '#queue-panel',
  sidebar: '#sidebar',
};

function actionFor(id: OverlayId, open: boolean): Action | null {
  switch (id) {
    case 'modal':
      return open ? null : { type: 'modal', modal: null };
    case 'volume':
      return { type: 'volume-popover', open };
    case 'search':
      return { type: 'search-overlay', open };
    case 'nowplaying':
      return { type: 'now-playing', open };
    case 'queue':
      return { type: 'queue-open', open };
    case 'sidebar':
      return { type: 'sidebar-drawer', open };
  }
}

export function isOverlayOpen(id: OverlayId, state: ShellState): boolean {
  switch (id) {
    case 'modal':
      return state.modal !== null;
    case 'volume':
      return state.volumePopoverOpen;
    case 'search':
      return state.searchOverlayOpen;
    case 'nowplaying':
      return state.nowPlayingOpen;
    case 'queue':
      return state.queueOpen && state.layout.queueMode !== 'docked';
    case 'sidebar':
      return state.sidebarDrawerOpen;
  }
}

function needsFreeze(id: OverlayId, state: ShellState): boolean {
  if (id === 'modal' || id === 'volume' || id === 'sidebar') {
    return true;
  }
  if (id === 'queue') {
    return state.layout.queueMode === 'drawer';
  }
  return false;
}

export function transitionMs(): number {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
}

export class OverlayManager {
  private readonly triggers = new Map<OverlayId, HTMLElement | null>();
  private readonly traps = new Map<OverlayId, () => void>();
  private readonly releaseTimers = new Map<OverlayId, number>();
  private readonly openState = new Map<OverlayId, boolean>();

  constructor(
    private readonly store: Store,
    private readonly viewHost: ViewHost,
  ) {
    store.subscribe((state) => {
      for (const id of ESC_ORDER) {
        const open = isOverlayOpen(id, state);
        const was = this.openState.get(id) ?? false;
        if (open === was) {
          continue;
        }
        this.openState.set(id, open);
        if (open) {
          this.onOpened(id, state);
        } else {
          this.onClosed(id);
        }
      }
    });
  }

  async open(id: OverlayId, trigger?: HTMLElement | null): Promise<void> {
    const active = document.activeElement;
    this.triggers.set(id, trigger ?? (active instanceof HTMLElement ? active : null));
    const pending = this.releaseTimers.get(id);
    if (pending !== undefined) {
      window.clearTimeout(pending);
      this.releaseTimers.delete(id);
    }
    const state = this.store.getState();
    if (needsFreeze(id, state)) {
      await this.viewHost.acquire(id);
    }
    const action = actionFor(id, true);
    if (action) {
      this.store.dispatch(action);
    }
  }

  close(id: OverlayId): void {
    const action = actionFor(id, false);
    if (action) {
      this.store.dispatch(action);
    }
  }

  closeTop(): boolean {
    const state = this.store.getState();
    for (const id of ESC_ORDER) {
      if (isOverlayOpen(id, state)) {
        this.close(id);
        return true;
      }
    }
    return false;
  }

  private onOpened(id: OverlayId, state: ShellState): void {
    if (needsFreeze(id, state) && !this.viewHost.hasLease(id)) {
      this.viewHost.acquire(id).catch((error: unknown) => {
        console.warn('[overlays] freeze failed', error);
      });
    }
    window.requestAnimationFrame(() => {
      const container = document.querySelector<HTMLElement>(CONTAINERS[id]);
      if (!container) {
        return;
      }
      const autofocus = container.querySelector<HTMLElement>('[data-autofocus]');
      const release = trapFocus(container, autofocus);
      const previous = this.traps.get(id);
      if (previous) {
        previous();
      }
      this.traps.set(id, release);
    });
  }

  private onClosed(id: OverlayId): void {
    const release = this.traps.get(id);
    if (release) {
      release();
      this.traps.delete(id);
    }
    const trigger = this.triggers.get(id);
    this.triggers.delete(id);
    if (trigger && trigger.isConnected) {
      trigger.focus({ preventScroll: true });
    }
    const timer = window.setTimeout(() => {
      this.releaseTimers.delete(id);
      this.viewHost.release(id);
    }, transitionMs());
    this.releaseTimers.set(id, timer);
  }
}
