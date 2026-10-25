import type { FlatItem } from '@musix/bridge/contract';
import type { SearchSuggestions } from '../../shared/types';
import type { AppContext } from '../context';
import { h, hydrate, icon } from '../dom';

const DEBOUNCE_MS = 150;
const ARTWORK_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(googleusercontent\.com|ggpht\.com|ytimg\.com)\//;

let panelCounter = 0;

type Choice = { kind: 'query'; text: string } | { kind: 'item'; item: FlatItem };

export function attachSuggestions(ctx: AppContext, form: HTMLFormElement, input: HTMLInputElement): void {
  const { api, viewHost, router } = ctx;
  panelCounter += 1;
  const panelId = `suggest-panel-${panelCounter}`;
  const lease = `suggest-${panelCounter}`;
  const panel = h('div', {
    className: 'suggest-panel',
    attrs: { id: panelId, role: 'listbox', hidden: true },
  });
  form.append(panel);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', panelId);

  let timer: number | null = null;
  let token = 0;
  let current: SearchSuggestions | null = null;
  let choices: Choice[] = [];
  let rows: HTMLElement[] = [];
  let selected = -1;
  let open = false;

  const setOpen = (next: boolean): void => {
    if (next === open) {
      return;
    }
    open = next;
    panel.hidden = !next;
    input.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) {
      viewHost.acquire(lease).catch((error: unknown) => {
        console.warn('[suggest] freeze failed', error);
      });
    } else {
      viewHost.release(lease);
      select(-1);
    }
  };

  const select = (index: number): void => {
    selected = index;
    rows.forEach((row, i) => {
      row.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    const row = rows[index];
    if (row) {
      input.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const choose = (choice: Choice): void => {
    setOpen(false);
    if (choice.kind === 'query') {
      input.value = choice.text;
      if (router.search(choice.text)) {
        input.blur();
      }
      return;
    }
    const item = choice.item;
    input.blur();
    if (item.playable && item.videoId) {
      api.send('view:command', { type: 'playVideo', videoId: item.videoId, playlistId: item.playlistId });
      return;
    }
    if (item.browseId) {
      api.send('view:command', { type: 'openBrowse', browseId: item.browseId });
      return;
    }
    router.search(item.title);
  };

  const fill = (text: string): void => {
    input.value = `${text} `;
    input.focus();
    request();
  };

  const queryRow = (text: string, typed: string, index: number): HTMLElement => {
    const lower = text.toLowerCase();
    const prefix = typed.trim().toLowerCase();
    const label = h('span', { className: 'suggest-text truncate' });
    if (prefix !== '' && lower.startsWith(prefix)) {
      label.append(
        h('span', { className: 'suggest-typed', text: text.slice(0, prefix.length) }),
        h('strong', { text: text.slice(prefix.length) }),
      );
    } else {
      label.textContent = text;
    }
    const fillButton = h(
      'button',
      {
        className: 'icon-btn suggest-fill',
        attrs: { type: 'button', tabindex: -1, 'aria-label': `Edit search: ${text}` },
        on: {
          mousedown: (event) => {
            event.preventDefault();
          },
          click: (event) => {
            event.stopPropagation();
            fill(text);
          },
        },
      },
      [icon('arrow-up-left')],
    );
    return h(
      'div',
      {
        className: 'suggest-row',
        attrs: { id: `${panelId}-${index}`, role: 'option', 'aria-selected': 'false' },
        on: {
          click: () => {
            choose({ kind: 'query', text });
          },
        },
      },
      [h('span', { className: 'suggest-icon' }, [icon('search')]), label, fillButton],
    );
  };

  const itemRow = (item: FlatItem, index: number): HTMLElement => {
    const art = ARTWORK_HOSTS.test(item.artworkUrl)
      ? h('img', {
          className: `suggest-art${item.type === 'artist' ? ' is-round' : ''}`,
          attrs: {
            src: item.artworkUrl,
            alt: '',
            width: 40,
            height: 40,
            loading: 'lazy',
            decoding: 'async',
            referrerpolicy: 'no-referrer',
          },
        })
      : h('span', { className: 'suggest-art art-placeholder' }, [icon('music')]);
    return h(
      'div',
      {
        className: 'suggest-row suggest-item',
        attrs: { id: `${panelId}-${index}`, role: 'option', 'aria-selected': 'false' },
        on: {
          click: () => {
            choose({ kind: 'item', item });
          },
        },
      },
      [
        art,
        h('span', { className: 'suggest-meta' }, [
          h('span', { className: 'suggest-title truncate', text: item.title }),
          item.subtitle === ''
            ? null
            : h('span', { className: 'suggest-subtitle truncate', text: item.subtitle }),
        ]),
      ],
    );
  };

  const render = (suggestions: SearchSuggestions): void => {
    current = suggestions;
    choices = [
      ...suggestions.queries.map((text): Choice => ({ kind: 'query', text })),
      ...suggestions.items.map((item): Choice => ({ kind: 'item', item })),
    ];
    rows = choices.map((choice, index) =>
      choice.kind === 'query' ? queryRow(choice.text, input.value, index) : itemRow(choice.item, index),
    );
    const children: HTMLElement[] = rows.slice(0, suggestions.queries.length);
    if (suggestions.queries.length > 0 && suggestions.items.length > 0) {
      children.push(h('div', { className: 'suggest-divider', attrs: { role: 'presentation' } }));
    }
    children.push(...rows.slice(suggestions.queries.length));
    panel.replaceChildren(...children);
    hydrate(panel);
    selected = -1;
    setOpen(choices.length > 0 && document.activeElement === input);
  };

  const request = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    const value = input.value;
    if (value.trim() === '') {
      token += 1;
      current = null;
      setOpen(false);
      return;
    }
    timer = window.setTimeout(() => {
      timer = null;
      token += 1;
      const mine = token;
      api
        .invoke('search:suggest', value.slice(0, 500))
        .then((suggestions) => {
          if (mine !== token || !suggestions || input.value !== value) {
            return;
          }
          render(suggestions);
        })
        .catch((error: unknown) => {
          console.warn('[suggest] request failed', error);
        });
    }, DEBOUNCE_MS);
  };

  panel.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  input.addEventListener('input', request);
  input.addEventListener('focus', () => {
    if (current && current.query.trim() === input.value.trim() && choices.length > 0) {
      setOpen(true);
    } else if (input.value.trim() !== '') {
      request();
    }
  });
  input.addEventListener('blur', () => {
    setOpen(false);
  });
  input.addEventListener('keydown', (event) => {
    if (!open) {
      if (event.key === 'ArrowDown' && choices.length > 0) {
        event.preventDefault();
        setOpen(true);
        select(0);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      select(selected + 1 >= rows.length ? 0 : selected + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      select(selected <= 0 ? rows.length - 1 : selected - 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      const choice = choices[selected];
      if (choice) {
        event.preventDefault();
        choose(choice);
      }
    }
  });
  form.addEventListener('submit', () => {
    token += 1;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    setOpen(false);
  });
}
