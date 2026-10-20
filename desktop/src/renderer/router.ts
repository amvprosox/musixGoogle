import type { ShellApi } from '../shared/channels';
import { normalizeQuery } from '../shared/routes';
import type { NavRoute } from '../shared/types';
import type { OverlayManager } from './overlays';
import type { Store } from './state';

export class Router {
  constructor(
    private readonly store: Store,
    private readonly api: ShellApi,
    private readonly overlays: OverlayManager,
  ) {}

  go(route: NavRoute): void {
    const state = this.store.getState();
    if (state.settingsOpen) {
      this.store.dispatch({ type: 'settings-open', open: false });
    }
    if (state.sidebarDrawerOpen) {
      this.overlays.close('sidebar');
    }
    this.api.send('view:command', { type: 'navigate', route });
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
    if (state.searchOverlayOpen) {
      this.overlays.close('search');
    }
    this.api.send('view:command', { type: 'search', query: normalized });
    return true;
  }

  back(): void {
    if (this.store.getState().settingsOpen) {
      this.closeSettings();
      return;
    }
    this.api.send('view:history', 'back');
  }

  forward(): void {
    this.api.send('view:history', 'forward');
  }
}
