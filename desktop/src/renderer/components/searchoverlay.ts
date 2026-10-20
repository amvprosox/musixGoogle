import type { AppContext } from '../context';
import { h, hydrate, iconButton } from '../dom';
import { buildSearchForm } from './topbar';

export function mountSearchOverlay(root: HTMLElement, ctx: AppContext): HTMLInputElement {
  const { store, overlays } = ctx;
  const { form, input } = buildSearchForm(ctx, {
    id: 'search-overlay-input',
    autofocus: true,
    showHint: false,
  });
  const close = iconButton({
    icon: 'arrow-left',
    label: 'Close search',
    onClick: () => {
      overlays.close('search');
    },
  });
  root.replaceChildren(
    h('div', { className: 'search-overlay-bar' }, [close, form]),
    h('div', { className: 'search-overlay-body', attrs: { 'data-scroll': 'true' } }, [
      h('p', { text: 'Search for songs, albums, artists, and playlists. Press Enter to see results.' }),
    ]),
  );
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Search');
  hydrate(root);

  store.select(
    (state) => state.searchOverlayOpen,
    (open) => {
      root.hidden = !open;
      if (open) {
        const state = store.getState();
        input.value = state.route === 'search' ? state.searchQuery : '';
      }
    },
  );
  return input;
}
