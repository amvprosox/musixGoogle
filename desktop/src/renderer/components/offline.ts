import type { ViewStatus } from '../../shared/types';
import type { AppContext } from '../context';
import { h, hydrate, icon } from '../dom';
import type { IconName } from '../icons';
import { contentSkeleton } from './skeleton';

type Screen =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'error'; description: string }
  | { kind: 'recovering' };

export function screenFor(online: boolean, status: ViewStatus, initialized: boolean): Screen {
  if (!online) {
    return { kind: 'offline' };
  }
  if (!initialized) {
    return { kind: 'loading' };
  }
  switch (status.kind) {
    case 'ready':
      return { kind: 'none' };
    case 'loading':
      return { kind: 'loading' };
    case 'error':
      return { kind: 'error', description: status.description };
    case 'crashed':
    case 'recovering':
      return { kind: 'recovering' };
  }
}

function stateCard(options: {
  id: string;
  iconName: IconName;
  tone?: 'danger' | 'warning';
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}): HTMLElement {
  const button = options.action
    ? h(
        'button',
        {
          className: 'btn btn-primary',
          attrs: { type: 'button', id: `${options.id}-retry` },
          on: { click: options.action.onClick },
        },
        [icon('refresh-cw'), h('span', { text: options.action.label })],
      )
    : null;
  return h('div', { className: 'state-screen', attrs: { id: options.id, role: 'status' } }, [
    h('div', { className: 'state-card' }, [
      h('span', { className: 'state-icon', attrs: { 'data-tone': options.tone ?? null } }, [
        icon(options.iconName),
      ]),
      h('h2', { text: options.title }),
      h('p', { text: options.message }),
      button,
    ]),
  ]);
}

export function mountViewState(root: HTMLElement, ctx: AppContext): void {
  const { store, api } = ctx;
  let currentKey = '';

  const retry = (): void => {
    if (!navigator.onLine) {
      ctx.toasts.show({
        variant: 'warning',
        title: 'Still offline',
        message: 'Check your network connection and try again.',
      });
      return;
    }
    store.dispatch({ type: 'online', online: true });
    api.send('view:reload', null);
  };

  store.select(
    (state) => ({
      screen: screenFor(state.online, state.viewStatus, state.initialized),
      cols: state.layout.gridColumns,
    }),
    ({ screen, cols }) => {
      const key = `${JSON.stringify(screen)}:${screen.kind === 'loading' ? cols : 0}`;
      if (key === currentKey) {
        return;
      }
      currentKey = key;
      root.hidden = screen.kind === 'none';
      switch (screen.kind) {
        case 'none':
          root.replaceChildren();
          return;
        case 'loading':
          root.replaceChildren(contentSkeleton(cols));
          return;
        case 'offline':
          root.replaceChildren(
            stateCard({
              id: 'offline-screen',
              iconName: 'wifi-off',
              tone: 'warning',
              title: 'You are offline',
              message:
                'Musix needs an internet connection to stream YouTube Music. It reconnects automatically when your network is back.',
              action: { label: 'Retry', onClick: retry },
            }),
          );
          break;
        case 'error':
          root.replaceChildren(
            stateCard({
              id: 'error-screen',
              iconName: 'circle-alert',
              tone: 'danger',
              title: 'YouTube Music could not load',
              message:
                screen.description === ''
                  ? 'The page failed to load.'
                  : `The page failed to load (${screen.description}).`,
              action: { label: 'Retry', onClick: retry },
            }),
          );
          break;
        case 'recovering':
          root.replaceChildren(
            stateCard({
              id: 'recovering-screen',
              iconName: 'rotate-cw',
              title: 'Recovering',
              message: 'YouTube Music stopped unexpectedly. Restoring your last page.',
            }),
          );
          break;
      }
      hydrate(root);
    },
  );

  window.addEventListener('online', () => {
    const wasOffline = !store.getState().online;
    store.dispatch({ type: 'online', online: true });
    if (wasOffline) {
      api.send('view:reload', null);
      ctx.toasts.show({ variant: 'success', title: 'Back online', message: 'Reloading YouTube Music.' });
    }
  });
  window.addEventListener('offline', () => {
    store.dispatch({ type: 'online', online: false });
  });
}
