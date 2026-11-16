import type { ShellApi } from '../shared/channels';
import { normalizeQuery } from '../shared/routes';
import type { NavRoute } from '../shared/types';
import type { OverlayManager } from './overlays';
import type { Store } from './state';

export class Router {
  private readonly backHandlers: (() => boolean)[] = [];
  /** Called instead of navigating when an online-only page is opened while offline. */
  offlineNotice: (() => void) | null = null;

  registerBack(handler: () => boolean): () => void {
    this.backHandlers.push(handler);
    return () => {
      const index = this.backHandlers.indexOf(handler);
      if (index !== -1) {
        this.backHandlers.splice(index, 1);
      }
    };
  }

  constructor(
    private readonly store: Store,
    private readonly api: ShellApi,
    private readonly overlays: OverlayManager,
  ) {}

  go(route: NavRoute): void {
    const state = this.store.getState();
    if (!state.online) {
      this.offlineNotice?.();
      return;
    }
    if (state.lyricsOpen) {
      this.store.dispatch({ type: 'lyrics-open', open: false });
    }
    if (state.settingsOpen) {
      this.store.dispatch({ type: 'settings-open', open: false });
    }
    if (state.downloadsOpen) {
      this.store.dispatch({ type: 'downloads-open', open: false });
    }
    if (state.sidebarDrawerOpen) {
      this.overlays.close('sidebar');
    }
    this.api.send('view:command', { type: 'navigate', route });
  }

  openDownloads(): void {
    const state = this.store.getState();
    if (state.sidebarDrawerOpen) {
      this.overlays.close('sidebar');
    }
    if (state.nowPlayingOpen) {
      this.overlays.close('nowplaying');
    }
    if (state.searchOverlayOpen) {
      this.overlays.close('search');
    }
    this.store.dispatch({ type: 'downloads-open', open: true });
  }

  closeDownloads(): void {
    this.store.dispatch({ type: 'downloads-open', open: false });
  }

  openSettings(): void {
    const state = this.store.getState();
    if (state.sidebarDrawerOpen) {
      this.overlays.close('sidebar');
    }
    if (state.nowPlayingOpen) {
      this.overlays.close('nowplaying');
    }
    if (state.searchOverlayOpen) {
      this.overlays.close('search');
    }
    this.store.dispatch({ type: 'settings-open', open: true });
  }

  closeSettings(): void {
    this.store.dispatch({ type: 'settings-open', open: false });
  }

  search(query: string): boolean {
    const normalized = normalizeQuery(query);
    if (normalized === '') {
      return false;
    }
    const state = this.store.getState();
    if (state.settingsOpen) {
      this.store.dispatch({ type: 'settings-open', open: false });
    }
    if (state.downloadsOpen) {
      this.store.dispatch({ type: 'downloads-open', open: false });
    }
    if (state.lyricsOpen) {
      this.store.dispatch({ type: 'lyrics-open', open: false });
    }
    if (state.searchOverlayOpen) {
      this.overlays.close('search');
    }
    this.api.send('view:command', { type: 'search', query: normalized });
    return true;
  }

  back(): void {
    for (const handler of [...this.backHandlers].reverse()) {
      if (handler()) {
        return;
      }
    }
    if (this.store.getState().settingsOpen) {
      this.closeSettings();
      return;
    }
    if (this.store.getState().downloadsOpen) {
      this.closeDownloads();
      return;
    }
    this.api.send('view:history', 'back');
  }

  forward(): void {
    this.api.send('view:history', 'forward');
  }
}
