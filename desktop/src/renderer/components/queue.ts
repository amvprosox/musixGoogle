import { queueEquals } from '../../shared/state-diff';
import type { QueueItem } from '../../shared/types';
import type { AppContext } from '../context';
import { h, hydrate, icon, iconButton, setText } from '../dom';
import { smoothScrollIntoView } from '../scroll';

function row(item: QueueItem, onPlay: (index: number) => void): HTMLTableRowElement {
  const play = (): void => {
    onPlay(item.index);
  };
  const thumb = item.thumbnailUrl
    ? h('img', {
        className: 'queue-thumb',
        attrs: {
          src: item.thumbnailUrl,
          alt: '',
          loading: 'lazy',
          width: 40,
          height: 40,
          referrerpolicy: 'no-referrer',
          decoding: 'async',
        },
      })
    : h('div', { className: 'queue-thumb art-placeholder', attrs: { 'aria-hidden': 'true' } }, [
        icon('music'),
      ]);
  return h(
    'tr',
    {
      className: 'queue-row',
      attrs: {
        tabindex: 0,
        'data-index': item.index,
        'aria-current': item.isCurrent ? 'true' : null,
        'aria-label': `Play ${item.title}${item.artist ? ` by ${item.artist}` : ''}`,
      },
      on: {
        click: play,
        keydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            play();
          }
        },
      },
    },
    [
      h('td', { className: 'col-index', text: String(item.index + 1) }),
      h('td', { className: 'col-art' }, [thumb]),
      h('td', { className: 'col-title' }, [
        h('span', {
          className: 'queue-title truncate',
          attrs: { 'data-tooltip-overflow': 'true', 'data-tooltip-placement': 'top' },
          text: item.title,
        }),
        h('span', {
          className: 'queue-artist queue-sub truncate',
          attrs: { 'data-tooltip-overflow': 'true', 'data-tooltip-placement': 'top' },
          text: item.artist,
        }),
      ]),
      h('td', { className: 'col-artist' }, [
        h('span', {
          className: 'queue-artist truncate',
          attrs: { 'data-tooltip-overflow': 'true', 'data-tooltip-placement': 'top' },
          text: item.artist,
        }),
      ]),
      h('td', { className: 'col-duration', text: item.duration }),
    ],
  );
}

export function mountQueue(root: HTMLElement, ctx: AppContext): void {
  const { store, actions, overlays } = ctx;
  const count = h('span', { className: 'badge', attrs: { id: 'queue-count' }, text: '0' });
  const close = iconButton({
    icon: 'x',
    label: 'Close queue',
    attrs: { id: 'queue-close' },
    onClick: () => {
      overlays.close('queue');
    },
  });
  const tbody = h('tbody');
  const table = h('table', { className: 'queue-table', attrs: { id: 'queue-table' } }, [
    h('caption', { className: 'sr-only', text: 'Up next' }),
    h('thead', {}, [
      h('tr', {}, [
        h('th', { className: 'col-index', attrs: { scope: 'col' }, text: '#' }),
        h('th', { className: 'col-art', attrs: { scope: 'col' } }, [
          h('span', { className: 'sr-only', text: 'Artwork' }),
        ]),
        h('th', { className: 'col-title', attrs: { scope: 'col' }, text: 'Title' }),
        h('th', { className: 'col-artist', attrs: { scope: 'col' }, text: 'Artist' }),
        h('th', { className: 'col-duration', attrs: { scope: 'col' }, text: 'Time' }),
      ]),
    ]),
    tbody,
  ]);
  const empty = h('div', { className: 'empty-state', attrs: { id: 'queue-empty' } }, [
    icon('list-music'),
    h('h3', { text: 'Your queue is empty' }),
    h('p', { text: 'Play a song, album, or playlist and the tracks coming up next appear here.' }),
  ]);
  const body = h('div', { className: 'panel-body', attrs: { 'data-scroll': 'true' } }, [table, empty]);
  const panel = h('div', { className: 'panel' }, [
    h('div', { className: 'panel-header' }, [
      h('h2', { className: 'panel-title', text: 'Queue' }),
      count,
      close,
    ]),
    body,
  ]);
  root.replaceChildren(panel);
  root.setAttribute('aria-label', 'Queue');
  hydrate(root);

  let rendered: QueueItem[] = [];
  const onPlay = (index: number): void => {
    actions.playQueueIndex(index);
  };

  store.select(
    (state) => state.queue,
    (queue) => {
      setText(count, String(queue.length));
      table.hidden = queue.length === 0;
      empty.hidden = queue.length > 0;
      if (queueEquals(queue, rendered)) {
        return;
      }
      rendered = queue;
      const fragment = document.createDocumentFragment();
      for (const item of queue) {
        fragment.append(row(item, onPlay));
      }
      tbody.replaceChildren(fragment);
      hydrate(tbody);
      const current = tbody.querySelector<HTMLElement>('tr[aria-current="true"]');
      if (current && !root.contains(document.activeElement)) {
        smoothScrollIntoView(current);
      }
    },
  );

  store.select(
    (state) => ({ mode: state.layout.queueMode, open: state.queueOpen }),
    ({ mode, open }) => {
      close.hidden = false;
      if (mode === 'docked') {
        root.removeAttribute('role');
        root.removeAttribute('aria-modal');
      } else {
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
      }
      root.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) {
        root.removeAttribute('inert');
      } else {
        root.setAttribute('inert', '');
      }
    },
  );
}
