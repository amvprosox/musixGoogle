import type { AppContext } from '../context';
import { h } from '../dom';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string | null;
  tone: 'danger' | 'default';
}

export function mountModal(
  root: HTMLElement,
  ctx: Pick<AppContext, 'store' | 'overlays'>,
): (options: ConfirmOptions) => Promise<boolean> {
  const { store, overlays } = ctx;
  let resolver: ((value: boolean) => void) | null = null;
  let counter = 0;

  const settle = (value: boolean): void => {
    const resolve = resolver;
    resolver = null;
    overlays.close('modal');
    if (resolve) {
      resolve(value);
    }
  };

  store.select(
    (state) => state.modal,
    (modal) => {
      if (!modal) {
        root.replaceChildren();
        if (resolver) {
          const resolve = resolver;
          resolver = null;
          resolve(false);
        }
        return;
      }
      const titleId = `${modal.id}-title`;
      const dialog = h(
        'div',
        {
          className: 'modal',
          attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId, id: modal.id },
        },
        [
          h('h2', { attrs: { id: titleId }, text: modal.title }),
          h('p', { text: modal.message }),
          h('div', { className: 'modal-actions' }, [
            modal.cancelLabel === null
              ? null
              : h('button', {
                  className: 'btn',
                  attrs: { type: 'button', 'data-autofocus': 'true', id: `${modal.id}-cancel` },
                  text: modal.cancelLabel,
                  on: {
                    click: () => {
                      settle(false);
                    },
                  },
                }),
            h('button', {
              className: modal.tone === 'danger' ? 'btn btn-primary btn-confirm-danger' : 'btn btn-primary',
              attrs: {
                type: 'button',
                id: `${modal.id}-confirm`,
                'data-autofocus': modal.cancelLabel === null ? 'true' : null,
              },
              text: modal.confirmLabel,
              on: {
                click: () => {
                  settle(true);
                },
              },
            }),
          ]),
        ],
      );
      const backdrop = h(
        'div',
        {
          className: 'modal-backdrop',
          on: {
            click: (event) => {
              if (event.target === backdrop) {
                settle(false);
              }
            },
          },
        },
        [dialog],
      );
      root.replaceChildren(backdrop);
    },
  );

  return (options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      if (resolver) {
        resolver(false);
      }
      counter += 1;
      const id = `confirm-${counter}`;
      overlays
        .open('modal')
        .then(() => {
          resolver = resolve;
          store.dispatch({ type: 'modal', modal: { id, ...options } });
        })
        .catch((error: unknown) => {
          console.warn('[modal] open failed', error);
          resolve(false);
        });
    });
}
