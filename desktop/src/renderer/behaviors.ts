import type { AppContext } from './context';
import { isTypingTarget } from './dom';

function describeDialogMessage(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  if (message === undefined || message === null) {
    return '';
  }
  if (typeof message === 'number' || typeof message === 'boolean' || typeof message === 'bigint') {
    return message.toString();
  }
  try {
    return typeof message === 'function' || typeof message === 'symbol' ? '' : JSON.stringify(message);
  } catch {
    return '';
  }
}

function stripTitles(root: ParentNode): void {
  const nodes = root instanceof Element && root.hasAttribute('title') ? [root] : [];
  for (const el of [...nodes, ...Array.from(root.querySelectorAll('[title]'))]) {
    const title = el.getAttribute('title') ?? '';
    el.removeAttribute('title');
    if (title.trim() !== '' && !el.hasAttribute('data-tooltip')) {
      el.setAttribute('data-tooltip', title.trim());
    }
  }
}

export function installBrowserBehaviors(ctx: AppContext): void {
  const { api } = ctx;
  stripTitles(document);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        stripTitles(record.target);
      }
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element) {
          stripTitles(node);
        }
      }
    }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title'],
  });

  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    },
    { capture: true, passive: false },
  );
  window.addEventListener(
    'dragstart',
    (event) => {
      event.preventDefault();
    },
    true,
  );
  window.addEventListener(
    'drop',
    (event) => {
      event.preventDefault();
    },
    true,
  );
  window.addEventListener(
    'dragover',
    (event) => {
      event.preventDefault();
    },
    true,
  );
  const blockModified = (event: MouseEvent): void => {
    if (
      event.button === 1 ||
      ((event.ctrlKey || event.shiftKey || event.metaKey) &&
        event.target instanceof Element &&
        event.target.closest('a'))
    ) {
      event.preventDefault();
    }
  };
  window.addEventListener('auxclick', blockModified, true);
  window.addEventListener(
    'mousedown',
    (event) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    },
    true,
  );
  window.addEventListener('click', blockModified, true);

  window.addEventListener(
    'contextmenu',
    (event) => {
      event.preventDefault();
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }
      if (isTypingTarget(target)) {
        if (target instanceof HTMLElement) {
          target.focus();
        }
        api.send('menu:open', { target: { kind: 'shellText' }, x: event.clientX, y: event.clientY });
        return;
      }
      const row = target.closest<HTMLElement>('tr.queue-row[data-index]');
      if (row) {
        const index = Number.parseInt(row.dataset.index ?? '', 10);
        if (Number.isInteger(index) && index >= 0) {
          api.send('menu:open', { target: { kind: 'queue', index }, x: event.clientX, y: event.clientY });
        }
        return;
      }
      if (target.closest('#player-track, #compact-open, .np-meta, .np-art')) {
        if (ctx.store.getState().player?.hasTrack === true) {
          api.send('menu:open', { target: { kind: 'player' }, x: event.clientX, y: event.clientY });
        }
      }
    },
    true,
  );

  const dialogs = window as unknown as {
    alert: (message?: unknown) => void;
    confirm: (message?: unknown) => boolean;
    prompt: (message?: unknown) => string | null;
  };
  const show = (message: unknown): void => {
    ctx
      .confirm({
        title: 'Musix',
        message: describeDialogMessage(message),
        confirmLabel: 'OK',
        cancelLabel: null,
        tone: 'default',
      })
      .catch(() => undefined);
  };
  dialogs.alert = (message?: unknown) => {
    show(message);
  };
  dialogs.confirm = (message?: unknown) => {
    show(message);
    return false;
  };
  dialogs.prompt = (message?: unknown) => {
    show(message);
    return null;
  };
}
