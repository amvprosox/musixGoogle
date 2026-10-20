import type { ShellRoute } from '../../shared/types';
import type { AppContext } from '../context';
import { h, hydrate, icon, setAttr } from '../dom';
import type { IconName } from '../icons';
import { activeRoute } from '../state';

interface BottomEntry {
  id: ShellRoute;
  label: string;
  icon: IconName;
}

const ENTRIES: readonly BottomEntry[] = [
  { id: 'home', label: 'Home', icon: 'house' },
  { id: 'explore', label: 'Explore', icon: 'compass' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function mountBottomNav(root: HTMLElement, ctx: AppContext): void {
  const { router, overlays, store } = ctx;
  const buttons = new Map<ShellRoute, HTMLButtonElement>();
  const inner = h(
    'div',
    { className: 'bottom-nav-inner' },
    ENTRIES.map((entry) => {
      const button = h(
        'button',
        {
          className: 'bottom-nav-item',
          attrs: { type: 'button', 'data-nav': entry.id, 'aria-label': entry.label },
          on: {
            click: () => {
              if (entry.id === 'settings') {
                router.openSettings();
                return;
              }
              if (entry.id === 'search') {
                overlays.open('search', button).catch((error: unknown) => {
                  console.warn('[bottomnav] could not open search', error);
                });
                return;
              }
              if (entry.id === 'home' || entry.id === 'explore' || entry.id === 'library') {
                router.go(entry.id);
              }
            },
          },
        },
        [icon(entry.icon), h('span', { text: entry.label })],
      );
      buttons.set(entry.id, button);
      return button;
    }),
  );
  root.replaceChildren(inner);
  root.setAttribute('aria-label', 'Primary');
  hydrate(root);

  store.select(
    (state) => activeRoute(state),
    (route) => {
      for (const [key, button] of buttons) {
        setAttr(button, 'aria-current', key === route ? 'page' : null);
      }
    },
  );
}
