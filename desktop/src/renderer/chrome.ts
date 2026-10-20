import type { WindowButton } from '../shared/types';
import type { AppContext } from './context';
import { h, hydrate, iconButton, setButtonIcon, setLabel } from './dom';

const INTERACTIVE = 'button, input, a, select, textarea, [role="button"], [role="slider"], form';

export function mountWindowControls(topbar: HTMLElement, ctx: AppContext): void {
  const { store, api } = ctx;
  const inner = topbar.querySelector<HTMLElement>('.topbar-inner');
  if (!inner) {
    return;
  }
  inner.classList.add('drag-region');
  const controls = h('div', {
    className: 'window-controls',
    attrs: { id: 'window-controls', role: 'group', 'aria-label': 'Window' },
  });
  const buttons = new Map<WindowButton, HTMLButtonElement>();
  const make = (button: WindowButton): HTMLButtonElement => {
    const element = iconButton({
      icon: button === 'minimize' ? 'minus' : button === 'maximize' ? 'square' : 'x',
      label: button === 'minimize' ? 'Minimize' : button === 'maximize' ? 'Maximize' : 'Close',
      className: `window-btn window-btn-${button}`,
      attrs: { id: `window-${button}` },
      onClick: () => {
        api.send('window:control', button === 'maximize' ? 'toggle-maximize' : button);
      },
    });
    buttons.set(button, element);
    return element;
  };

  const applyState = (maximized: boolean): void => {
    const maximize = buttons.get('maximize');
    if (maximize) {
      setButtonIcon(maximize, maximized ? 'copy' : 'square');
      setLabel(maximize, maximized ? 'Restore' : 'Maximize');
    }
  };

  inner.addEventListener('dblclick', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest(INTERACTIVE)) {
      return;
    }
    api.send('window:control', 'toggle-maximize');
  });

  store.select(
    (state) => ({ side: state.chrome.side, buttons: state.chrome.buttons.join(',') }),
    ({ side, buttons: order }) => {
      controls.replaceChildren(
        ...order
          .split(',')
          .filter(
            (entry): entry is WindowButton =>
              entry === 'minimize' || entry === 'maximize' || entry === 'close',
          )
          .map(make),
      );
      hydrate(controls);
      if (side === 'left') {
        inner.prepend(controls);
      } else {
        inner.append(controls);
      }
      controls.dataset.side = side;
      const current = store.getState().chrome;
      applyState(current.maximized || current.fullscreen);
    },
  );

  store.select(
    (state) => ({
      maximized: state.chrome.maximized,
      fullscreen: state.chrome.fullscreen,
      focused: state.chrome.focused,
    }),
    ({ maximized, fullscreen, focused }) => {
      const root = document.documentElement;
      root.dataset.window = fullscreen ? 'fullscreen' : maximized ? 'maximized' : 'normal';
      root.dataset.focused = focused ? 'true' : 'false';
      applyState(maximized || fullscreen);
    },
  );
}
