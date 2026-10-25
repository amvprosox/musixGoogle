import { formatTime } from '../../shared/format';
import { progressRatio, volumeIconName } from '../../shared/player-math';
import type { PlayerState } from '../../shared/types';
import type { AppContext } from '../context';
import { h, hydrate, icon, iconButton, setAttr, setButtonIcon, setImage, setLabel, setText } from '../dom';
import { lyricsToggle } from './lyrics';
import { displayedPlaying, type ShellState } from '../state';
import { Slider } from './slider';

export interface PlayerView {
  player: PlayerState | null;
  playing: boolean;
}

export function trackLabel(player: PlayerState | null): { title: string; artist: string } {
  if (!player) {
    return { title: '', artist: '' };
  }
  if (player.isAd) {
    return { title: 'Advertisement', artist: 'Skipping when possible' };
  }
  if (!player.hasTrack) {
    return { title: 'Nothing playing', artist: 'Pick something to play in YouTube Music' };
  }
  const artist = [player.artist, player.album].filter((part) => part !== '').join(' • ');
  return { title: player.title, artist };
}

export function createProgressSlider(ctx: AppContext, timeLabel: HTMLElement | null, id: string): Slider {
  const slider = new Slider({
    label: 'Seek',
    min: 0,
    max: 1,
    step: 5,
    bigStep: 30,
    className: 'progress-slider',
    tolerance: 2,
    format: (value) => formatTime(value),
    onInput: (value) => {
      if (timeLabel) {
        setText(timeLabel, formatTime(value));
      }
    },
    onCommit: (value) => {
      ctx.actions.seekTo(value);
    },
    onHover: (value, clientX, rect) => {
      ctx.tooltips.showAt(
        formatTime(value),
        { left: clientX - 1, top: rect.top + 8, width: 2, height: rect.height - 16 },
        'top',
      );
    },
    onHoverEnd: () => {
      ctx.tooltips.hide();
    },
  });
  slider.el.id = id;
  return slider;
}

export function createVolumeSlider(ctx: AppContext, id: string): Slider {
  const slider = new Slider({
    label: 'Volume',
    min: 0,
    max: 1,
    step: 0.05,
    bigStep: 0.2,
    className: 'volume-slider',
    tolerance: 0.02,
    format: (value) => `${Math.round(value * 100)} percent`,
    onInput: (value) => {
      ctx.actions.setVolume(value);
    },
    onCommit: (value) => {
      ctx.actions.setVolume(value);
    },
  });
  slider.el.id = id;
  return slider;
}

export function syncProgress(
  slider: Slider,
  current: HTMLElement,
  total: HTMLElement,
  player: PlayerState | null,
): void {
  const duration = player && player.hasTrack ? player.durationSec : 0;
  slider.setMax(duration > 0 ? duration : 1);
  slider.setDisabled(!player || !player.hasTrack || player.isAd || duration <= 0);
  if (!slider.isDragging()) {
    slider.setValue(player ? player.currentTimeSec : 0);
    setText(current, formatTime(player ? player.currentTimeSec : 0));
  }
  setText(total, formatTime(duration));
}

function controlsDisabled(state: ShellState): boolean {
  return !state.player || !state.player.hasTrack;
}

export function mountPlayerBar(root: HTMLElement, ctx: AppContext): void {
  const { store, actions, overlays } = ctx;

  const art = h('img', {
    className: 'art',
    attrs: { alt: '', width: 56, height: 56, referrerpolicy: 'no-referrer', decoding: 'async' },
  });
  const artPlaceholder = h('div', { className: 'art art-placeholder', attrs: { 'aria-hidden': 'true' } }, [
    icon('music'),
  ]);
  const title = h('div', {
    className: 'track-title truncate',
    attrs: { id: 'player-title', 'data-tooltip-overflow': 'true', 'data-tooltip-placement': 'top' },
  });
  const artist = h('div', {
    className: 'track-artist truncate',
    attrs: { id: 'player-artist', 'data-tooltip-overflow': 'true', 'data-tooltip-placement': 'top' },
  });
  const adBadge = h('span', { className: 'badge', attrs: { id: 'ad-badge' }, text: 'Ad' });
  const like = iconButton({
    icon: 'thumbs-up',
    label: 'Like',
    placement: 'top',
    attrs: { id: 'player-like', 'aria-pressed': 'false' },
    onClick: () => {
      actions.toggleLike();
    },
  });
  const skeletonArt = h('div', { className: 'art skeleton' });
  const skeletonText = h('div', { className: 'track-text' }, [
    h('div', { className: 'skeleton skeleton-line' }),
    h('div', { className: 'skeleton skeleton-line short' }),
  ]);
  const skeleton = h(
    'div',
    { className: 'track playerbar-skeleton', attrs: { id: 'player-skeleton', 'aria-hidden': 'true' } },
    [skeletonArt, skeletonText],
  );
  const trackInfo = h('div', { className: 'track', attrs: { id: 'player-track' } }, [
    art,
    artPlaceholder,
    h('div', { className: 'track-text' }, [title, artist]),
    adBadge,
    like,
  ]);

  const shuffle = iconButton({
    icon: 'shuffle',
    label: 'Shuffle',
    placement: 'top',
    attrs: { id: 'player-shuffle', 'aria-pressed': 'false' },
    onClick: () => {
      actions.toggleShuffle();
    },
  });
  const previous = iconButton({
    icon: 'skip-back',
    label: 'Previous',
    placement: 'top',
    attrs: { id: 'player-previous' },
    onClick: () => {
      actions.previous();
    },
  });
  const play = h(
    'button',
    {
      className: 'play-btn',
      attrs: {
        type: 'button',
        id: 'player-play',
        'aria-label': 'Play',
        'data-tooltip': 'Play',
        'data-tooltip-placement': 'top',
      },
      on: {
        click: () => {
          actions.togglePlay();
        },
      },
    },
    [icon('play')],
  );
  const next = iconButton({
    icon: 'skip-forward',
    label: 'Next',
    placement: 'top',
    attrs: { id: 'player-next' },
    onClick: () => {
      actions.next();
    },
  });
  const repeat = iconButton({
    icon: 'repeat',
    label: 'Repeat off',
    placement: 'top',
    attrs: { id: 'player-repeat', 'aria-pressed': 'false' },
    onClick: () => {
      actions.cycleRepeat();
    },
  });

  const currentTime = h('span', { className: 'time', attrs: { id: 'player-current' }, text: '0:00' });
  const totalTime = h('span', { className: 'time', attrs: { id: 'player-total' }, text: '0:00' });
  const progress = createProgressSlider(ctx, currentTime, 'player-progress');

  const mute = iconButton({
    icon: 'volume-2',
    label: 'Mute',
    placement: 'top',
    attrs: { id: 'player-mute' },
    onClick: () => {
      actions.toggleMute();
    },
  });
  const volume = createVolumeSlider(ctx, 'player-volume');
  const volumePopoverButton = iconButton({
    icon: 'volume-2',
    label: 'Volume',
    placement: 'top',
    className: 'volume-popover-btn',
    attrs: {
      id: 'player-volume-popover',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-controls': 'volume-popover',
    },
    onClick: () => {
      if (store.getState().volumePopoverOpen) {
        overlays.close('volume');
        return;
      }
      overlays.open('volume', volumePopoverButton).catch((error: unknown) => {
        console.warn('[playerbar] volume popover failed', error);
      });
    },
  });
  const queueToggle = iconButton({
    icon: 'list-music',
    label: 'Queue',
    placement: 'top',
    attrs: { id: 'queue-toggle', 'aria-pressed': 'false', 'aria-controls': 'queue-panel' },
    onClick: () => {
      const state = store.getState();
      if (state.queueOpen) {
        overlays.close('queue');
        return;
      }
      if (state.layout.queueMode === 'docked') {
        store.dispatch({ type: 'queue-open', open: true });
        return;
      }
      overlays.open('queue', queueToggle).catch((error: unknown) => {
        console.warn('[playerbar] queue failed', error);
      });
    },
  });

  const full = h(
    'div',
    { className: 'playerbar-inner full-player', attrs: { role: 'region', 'aria-label': 'Player' } },
    [
      h('div', { className: 'track-col' }, [skeleton, trackInfo]),
      h('div', { className: 'transport' }, [
        h('div', { className: 'transport-buttons' }, [shuffle, previous, play, next, repeat]),
        h('div', { className: 'progress-row' }, [currentTime, progress.el, totalTime]),
      ]),
      h('div', { className: 'right-controls' }, [
        h('div', { className: 'volume-group' }, [mute, volume.el]),
        volumePopoverButton,
        lyricsToggle(ctx, 'top', 'lyrics-toggle'),
        queueToggle,
      ]),
    ],
  );

  const compactArt = h('img', {
    className: 'art',
    attrs: { alt: '', width: 44, height: 44, referrerpolicy: 'no-referrer', decoding: 'async' },
  });
  const compactPlaceholder = h(
    'div',
    { className: 'art art-placeholder', attrs: { 'aria-hidden': 'true' } },
    [icon('music')],
  );
  const compactTitle = h('div', { className: 'track-title truncate', attrs: { id: 'compact-title' } });
  const compactArtist = h('div', { className: 'track-artist truncate' });
  const compactFill = h('div', { className: 'compact-progress-fill' });
  const compactOpen = h(
    'button',
    {
      className: 'compact-open',
      attrs: { type: 'button', id: 'compact-open', 'aria-label': 'Open now playing' },
      on: {
        click: () => {
          overlays.open('nowplaying', compactOpen).catch((error: unknown) => {
            console.warn('[playerbar] now playing failed', error);
          });
        },
      },
    },
    [compactArt, compactPlaceholder, h('div', { className: 'track-text' }, [compactTitle, compactArtist])],
  );
  const compactPlay = h(
    'button',
    {
      className: 'play-btn',
      attrs: {
        type: 'button',
        id: 'compact-play',
        'aria-label': 'Play',
        'data-tooltip': 'Play',
        'data-tooltip-placement': 'top',
      },
      on: {
        click: () => {
          actions.togglePlay();
        },
      },
    },
    [icon('play')],
  );
  const compactNext = iconButton({
    icon: 'skip-forward',
    label: 'Next',
    placement: 'top',
    attrs: { id: 'compact-next' },
    onClick: () => {
      actions.next();
    },
  });
  const compact = h('div', { className: 'compact-player' }, [
    h('div', { className: 'compact-inner' }, [
      h('div', { className: 'compact-progress', attrs: { 'aria-hidden': 'true' } }, [compactFill]),
      compactOpen,
      compactPlay,
      compactNext,
    ]),
  ]);

  root.replaceChildren(full, compact);
  hydrate(root);

  const popover = document.getElementById('volume-popover');
  const popoverMute = iconButton({
    icon: 'volume-2',
    label: 'Mute',
    placement: 'top',
    attrs: { id: 'popover-mute' },
    onClick: () => {
      actions.toggleMute();
    },
  });
  const popoverSlider = createVolumeSlider(ctx, 'popover-volume');
  if (popover) {
    popover.replaceChildren(popoverMute, popoverSlider.el);
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Volume');
    hydrate(popover);
  }

  const positionPopover = (): void => {
    if (!popover) {
      return;
    }
    const rect = volumePopoverButton.getBoundingClientRect();
    const width = 240;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    popover.style.left = `${left}px`;
    popover.style.bottom = `${Math.max(8, window.innerHeight - rect.top + 8)}px`;
  };

  store.select(
    (state) => state.volumePopoverOpen,
    (open) => {
      if (!popover) {
        return;
      }
      popover.hidden = !open;
      setAttr(volumePopoverButton, 'aria-expanded', open ? 'true' : 'false');
      if (open) {
        positionPopover();
      }
    },
  );
  window.addEventListener('resize', positionPopover);

  document.addEventListener('pointerdown', (event) => {
    if (!store.getState().volumePopoverOpen || !popover) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && (popover.contains(target) || volumePopoverButton.contains(target))) {
      return;
    }
    overlays.close('volume');
  });

  store.select(
    (state) => ({
      player: state.player,
      playing: displayedPlaying(state),
      disabled: controlsDisabled(state),
    }),
    ({ player, playing, disabled }) => {
      const loading = player === null;
      skeleton.hidden = !loading;
      trackInfo.hidden = loading;

      const labels = trackLabel(player);
      setText(title, labels.title);
      setText(artist, labels.artist);
      setText(compactTitle, loading ? 'Loading' : labels.title);
      setText(compactArtist, labels.artist);
      adBadge.hidden = !(player && player.isAd);

      const artUrl = player && player.hasTrack && !player.isAd ? player.artworkUrl : '';
      setImage(art, artUrl, player ? `${player.title} cover art` : '');
      artPlaceholder.hidden = artUrl !== '';
      setImage(compactArt, artUrl, player ? `${player.title} cover art` : '');
      compactPlaceholder.hidden = artUrl !== '';

      const playLabel = playing ? 'Pause' : 'Play';
      for (const button of [play, compactPlay]) {
        setButtonIcon(button, playing ? 'pause' : 'play');
        setLabel(button, playLabel);
        button.disabled = disabled;
      }
      for (const button of [previous, next, compactNext, shuffle, repeat]) {
        button.disabled = disabled;
      }

      const likeStatus = player ? player.likeStatus : 'INDIFFERENT';
      like.disabled = disabled || (player !== null && player.isAd);
      like.dataset.like = likeStatus;
      setAttr(like, 'aria-pressed', likeStatus === 'LIKE' ? 'true' : 'false');
      setLabel(like, likeStatus === 'LIKE' ? 'Remove like' : 'Like');

      setAttr(shuffle, 'aria-pressed', player && player.shuffle ? 'true' : 'false');
      setLabel(shuffle, player && player.shuffle ? 'Shuffle on' : 'Shuffle');

      const repeatMode = player ? player.repeatMode : 'NONE';
      setButtonIcon(repeat, repeatMode === 'ONE' ? 'repeat-1' : 'repeat');
      setAttr(repeat, 'aria-pressed', repeatMode === 'NONE' ? 'false' : 'true');
      setLabel(
        repeat,
        repeatMode === 'ALL' ? 'Repeat all' : repeatMode === 'ONE' ? 'Repeat one' : 'Repeat off',
      );

      syncProgress(progress, currentTime, totalTime, player);
      const ratio = player ? progressRatio(player.currentTimeSec, player.durationSec) : 0;
      compactFill.style.setProperty('--value', `${(ratio * 100).toFixed(2)}%`);

      const vol = player ? player.volume : 1;
      const muted = player ? player.isMuted : false;
      const volIcon = volumeIconName(vol, muted);
      for (const button of [mute, popoverMute]) {
        setButtonIcon(button, volIcon);
        setLabel(button, muted ? 'Unmute' : 'Mute');
      }
      setButtonIcon(volumePopoverButton, volIcon);
      volume.setValue(muted ? 0 : vol);
      popoverSlider.setValue(muted ? 0 : vol);
    },
  );

  store.select(
    (state) => state.queueOpen,
    (open) => {
      setAttr(queueToggle, 'aria-pressed', open ? 'true' : 'false');
      setLabel(queueToggle, open ? 'Hide queue' : 'Show queue');
    },
  );
}
