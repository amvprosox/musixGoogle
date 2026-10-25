import { activeLine } from '@musix/bridge/lyrics';
import type { Lyrics, LyricsResponse, PlayerState } from '../../shared/types';
import type { AppContext } from '../context';
import { h, hydrate, icon, iconButton, setText } from '../dom';

const LEAD_MS = 150;
const USER_SCROLL_HOLD_MS = 3500;
const ANCHOR = 0.33;

type LyricsView =
  { kind: 'idle' } | { kind: 'loading'; videoId: string } | { kind: 'ready'; response: LyricsResponse };

export function mountLyrics(root: HTMLElement, ctx: AppContext): void {
  const { store, api, actions } = ctx;
  const heading = h('h2', { className: 'panel-title', text: 'Lyrics', attrs: { id: 'lyrics-title' } });
  const track = h('p', { className: 'lyrics-track truncate' });
  const close = iconButton({
    icon: 'x',
    label: 'Close lyrics',
    attrs: { id: 'lyrics-close' },
    onClick: () => {
      store.dispatch({ type: 'lyrics-open', open: false });
    },
  });
  const body = h('div', { className: 'lyrics-body', attrs: { 'data-scroll': 'true' } });
  root.replaceChildren(
    h('div', { className: 'lyrics-header' }, [
      h('div', { className: 'lyrics-heading' }, [heading, track]),
      close,
    ]),
    body,
  );
  root.setAttribute('role', 'region');
  root.setAttribute('aria-labelledby', 'lyrics-title');
  hydrate(root);

  const cache = new Map<string, LyricsResponse>();
  let view: LyricsView = { kind: 'idle' };
  let lines: HTMLElement[] = [];
  let shown: Lyrics | null = null;
  let active = -2;
  let touchedAt = 0;
  let frame: number | null = null;
  let receivedAt = performance.now();
  let lastPlayer: PlayerState | null = null;
  let token = 0;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const message = (title: string, detail: string, retry: boolean): HTMLElement =>
    h('div', { className: 'lyrics-state' }, [
      icon('text-quote'),
      h('p', { className: 'lyrics-state-title', text: title }),
      detail === '' ? null : h('p', { className: 'lyrics-state-detail', text: detail }),
      retry
        ? h('button', {
            className: 'btn',
            attrs: { type: 'button' },
            text: 'Try again',
            on: {
              click: () => {
                const player = store.getState().player;
                if (player) {
                  cache.delete(player.videoId);
                }
                load(true);
              },
            },
          })
        : null,
    ]);

  const render = (): void => {
    lines = [];
    shown = null;
    active = -2;
    if (view.kind !== 'ready') {
      body.replaceChildren(
        h('div', { className: 'lyrics-state' }, [
          h('p', { className: 'lyrics-state-detail', text: 'Finding lyrics…' }),
        ]),
      );
      return;
    }
    const response = view.response;
    if (response.kind === 'missing') {
      body.replaceChildren(
        message('No lyrics for this song', 'Lyrics aren’t available for this track yet.', false),
      );
      return;
    }
    if (response.kind === 'error') {
      body.replaceChildren(message('Lyrics couldn’t load', response.message, true));
      return;
    }
    const lyrics = response.lyrics;
    if (lyrics.instrumental || lyrics.lines.length === 0) {
      body.replaceChildren(message('Instrumental', 'This track has no lyrics.', false));
      return;
    }
    shown = lyrics;
    const list = h('div', {
      className: 'lyrics-lines',
      dataset: { synced: lyrics.synced ? 'true' : 'false' },
    });
    lines = lyrics.lines.map((line, index) => {
      const text = line.text === '' ? ' ' : line.text;
      if (!lyrics.synced) {
        return h('p', { className: 'lyric-line', text });
      }
      return h('button', {
        className: 'lyric-line',
        attrs: { type: 'button', 'data-index': index, 'aria-label': `${text}. Play from this line` },
        text,
        on: {
          click: () => {
            touchedAt = 0;
            actions.seekTo(line.timeMs / 1000);
          },
        },
      });
    });
    list.append(...lines);
    const footer = h('div', { className: 'lyrics-footer' }, [
      lyrics.synced ? null : h('p', { text: 'These lyrics aren’t time-synced for this version.' }),
      h('p', { text: `Lyrics from ${lyrics.source}` }),
    ]);
    body.replaceChildren(list, footer);
    body.scrollTop = 0;
    tick();
  };

  const position = (): number => {
    const player = lastPlayer;
    if (!player) {
      return 0;
    }
    const base = player.currentTimeSec * 1000;
    if (!player.isPlaying || player.isAd) {
      return base;
    }
    const moved = base + (performance.now() - receivedAt);
    return player.durationSec > 0 ? Math.min(moved, player.durationSec * 1000) : moved;
  };

  const highlight = (index: number): void => {
    if (index === active) {
      return;
    }
    const previous = active;
    active = index;
    lines.forEach((line, i) => {
      line.classList.toggle('is-active', i === index);
      line.classList.toggle('is-past', i < index);
    });
    if (index < 0 || performance.now() - touchedAt < USER_SCROLL_HOLD_MS) {
      return;
    }
    const target = lines[index];
    if (!target) {
      return;
    }
    const top = target.offsetTop - body.clientHeight * ANCHOR;
    body.scrollTo({
      top: Math.max(0, top),
      behavior: reducedMotion.matches || previous < 0 ? 'auto' : 'smooth',
    });
  };

  const tick = (): void => {
    frame = null;
    const lyrics = shown;
    if (!lyrics || !lyrics.synced || !store.getState().lyricsOpen) {
      return;
    }
    highlight(activeLine(lyrics.lines, position() + LEAD_MS));
    if (lastPlayer && lastPlayer.isPlaying) {
      frame = requestAnimationFrame(tick);
    }
  };

  const schedule = (): void => {
    if (frame === null) {
      frame = requestAnimationFrame(tick);
    }
  };

  const load = (force: boolean): void => {
    const player = store.getState().player;
    const videoId = player && player.hasTrack && !player.isAd ? player.videoId : '';
    if (videoId === '') {
      view = { kind: 'ready', response: { kind: 'missing', videoId: '' } };
      render();
      return;
    }
    if (!force && view.kind !== 'idle') {
      const current = view.kind === 'loading' ? view.videoId : responseVideo(view.response);
      if (current === videoId) {
        return;
      }
    }
    const cached = cache.get(videoId);
    if (cached) {
      view = { kind: 'ready', response: cached };
      render();
      return;
    }
    token += 1;
    const mine = token;
    view = { kind: 'loading', videoId };
    render();
    api
      .invoke('lyrics:get', null)
      .then((response) => {
        if (response.kind !== 'error') {
          cache.set(videoId, response);
        }
        if (cache.size > 50) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) {
            cache.delete(oldest);
          }
        }
        if (mine !== token) {
          return;
        }
        view = { kind: 'ready', response };
        render();
      })
      .catch((error: unknown) => {
        if (mine !== token) {
          return;
        }
        view = {
          kind: 'ready',
          response: {
            kind: 'error',
            videoId,
            message: error instanceof Error ? error.message : 'Lyrics could not be loaded.',
          },
        };
        render();
      });
  };

  const markTouched = (): void => {
    touchedAt = performance.now();
  };
  body.addEventListener('wheel', markTouched, { passive: true });
  body.addEventListener('pointerdown', markTouched, { passive: true });
  body.addEventListener('keydown', markTouched, { passive: true });

  store.select(
    (state) => state.player,
    (player) => {
      lastPlayer = player;
      receivedAt = performance.now();
      const label =
        player && player.hasTrack ? [player.title, player.artist].filter(Boolean).join(' · ') : '';
      setText(track, label);
      if (!store.getState().lyricsOpen) {
        return;
      }
      load(false);
      schedule();
    },
  );

  store.select(
    (state) => state.lyricsOpen && !state.settingsOpen,
    (open) => {
      root.hidden = !open;
      if (open) {
        load(false);
        active = -2;
        schedule();
      } else if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    },
  );
}

export function lyricsToggle(ctx: AppContext, placement: 'top' | 'bottom', id: string): HTMLButtonElement {
  const { store, overlays } = ctx;
  const toggle = iconButton({
    icon: 'text-quote',
    label: 'Lyrics',
    placement,
    attrs: { id, 'aria-pressed': 'false', 'aria-controls': 'lyrics-panel' },
    onClick: () => {
      const state = store.getState();
      if (state.nowPlayingOpen) {
        overlays.close('nowplaying');
      }
      store.dispatch({ type: 'lyrics-open', open: !state.lyricsOpen });
    },
  });
  store.select(
    (state) => ({ open: state.lyricsOpen, hasTrack: state.player !== null && state.player.hasTrack }),
    ({ open, hasTrack }) => {
      toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Hide lyrics' : 'Show lyrics');
      toggle.setAttribute('data-tooltip', open ? 'Hide lyrics' : 'Show lyrics');
      toggle.disabled = !hasTrack && !open;
    },
  );
  return toggle;
}

function responseVideo(response: LyricsResponse): string {
  return response.kind === 'found' ? response.lyrics.videoId : response.videoId;
}
