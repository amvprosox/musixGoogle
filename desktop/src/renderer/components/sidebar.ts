import type { NavRoute, ShellRoute } from '../../shared/types';
import type { AppContext } from '../context';
import { h, hydrate, icon, setAttr, setButtonIcon, setLabel } from '../dom';
import type { IconName } from '../icons';
import { activeRoute } from '../state';

interface NavEntry {
  route: NavRoute;
  label: string;
  icon: IconName;
}

export const PRIMARY_NAV: readonly NavEntry[] = [
  { route: 'home', label: 'Home', icon: 'house' },
  { route: 'explore', label: 'Explore', icon: 'compass' },
  { route: 'library', label: 'Library', icon: 'library' },
];

export const COLLECTION_NAV: readonly NavEntry[] = [
  { route: 'liked', label: 'Liked Songs', icon: 'heart' },
  { route: 'playlists', label: 'Playlists', icon: 'list-music' },
];

function navButton(
  entry: { id: string; label: string; icon: IconName },
  onClick: () => void,
): HTMLButtonElement {
  return h(
    'button',
    {
      className: 'nav-item',
      attrs: { type: 'button', 'data-nav': entry.id, 'aria-label': entry.label },
      on: { click: onClick },
    },
    [icon(entry.icon), h('span', { className: 'nav-label', text: entry.label })],
  );
}

export function mountSidebar(root: HTMLElement, ctx: AppContext): void {
  const { store, router } = ctx;
  const buttons = new Map<ShellRoute, HTMLButtonElement>();

  const makeList = (entries: readonly NavEntry[]): HTMLUListElement =>
    h(
      'ul',
      { className: 'nav-list' },
      entries.map((entry) => {
        const button = navButton({ id: entry.route, label: entry.label, icon: entry.icon }, () => {
          router.go(entry.route);
        });
        buttons.set(entry.route, button);
        return h('li', {}, [button]);
      }),
    );

  const settingsButton = navButton({ id: 'settings', label: 'Settings', icon: 'settings' }, () => {
    if (store.getState().settingsOpen) {
      router.closeSettings();
      return;
    }
    router.openSettings();
  });
  buttons.set('settings', settingsButton);

  const collapseButton = h(
    'button',
    {
      className: 'nav-item collapse-toggle',
      attrs: { type: 'button', 'aria-label': 'Collapse sidebar', id: 'sidebar-collapse' },
      on: {
        click: () => {
          const collapsed = !store.getState().sidebarCollapsed;
          store.dispatch({ type: 'sidebar-collapsed', collapsed });
          ctx.api.send('window:sidebar-collapsed', collapsed);
        },
      },
    },
    [icon('panel-left-close'), h('span', { className: 'nav-label', text: 'Collapse' })],
  );

  const inner = h('div', { className: 'sidebar-inner' }, [
    h('div', { className: 'brand' }, [
      h('img', {
        className: 'brand-mark',
        attrs: { src: 'logo.svg', alt: '', width: 32, height: 32, loading: 'lazy' },
      }),
      h('span', { className: 'brand-name', text: 'Musix' }),
    ]),
    h('nav', { attrs: { 'aria-label': 'Primary' } }, [
      makeList(PRIMARY_NAV),
      h('div', { className: 'nav-group-label', text: 'Collection' }),
      makeList(COLLECTION_NAV),
    ]),
    h('div', { className: 'sidebar-footer' }, [settingsButton, collapseButton]),
  ]);
  root.replaceChildren(inner);
  root.setAttribute('aria-label', 'Sidebar');
  hydrate(root);

  store.select(
    (state) => ({
      route: activeRoute(state),
      mode: state.layout.sidebarMode,
      collapsed: state.sidebarCollapsed,
      canCollapse: state.layout.canCollapseSidebar,
    }),
    ({ route, mode, collapsed, canCollapse }) => {
      for (const [key, button] of buttons) {
        setAttr(button, 'aria-current', key === route ? 'page' : null);
        const label = button.getAttribute('aria-label') ?? '';
        if (mode === 'rail') {
          setAttr(button, 'data-tooltip', label);
          setAttr(button, 'data-tooltip-placement', 'right');
        } else {
          setAttr(button, 'data-tooltip', null);
        }
      }
      collapseButton.hidden = !canCollapse;
      const collapseLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      setLabel(collapseButton, collapseLabel);
      if (mode !== 'rail') {
        setAttr(collapseButton, 'data-tooltip', null);
      } else {
        setAttr(collapseButton, 'data-tooltip-placement', 'right');
      }
      setButtonIcon(collapseButton, collapsed ? 'panel-left-open' : 'panel-left-close');
      const text = collapseButton.querySelector('.nav-label');
      if (text) {
        text.textContent = collapsed ? 'Expand' : 'Collapse';
      }
      if (mode === 'drawer') {
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
      } else {
        root.removeAttribute('role');
        root.removeAttribute('aria-modal');
      }
    },
  );
}
