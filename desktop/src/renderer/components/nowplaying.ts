import { volumeIconName } from '../../shared/player-math';
import type { AppContext } from '../context';
import { h, hydrate, icon, iconButton, setAttr, setButtonIcon, setImage, setLabel, setText } from '../dom';
import { displayedPlaying } from '../state';
import { lyricsToggle } from './lyrics';
import { createProgressSlider, createVolumeSlider, syncProgress, trackLabel } from './playerbar';

export function mountNowPlaying(root: HTMLElement, ctx: AppContext): void {
  const { store, actions, overlays } = ctx;
  const art = h('img', {
    className: 'np-art',
    attrs: { alt: '', referrerpolicy: 'no-referrer', decoding: 'async', loading: 'lazy' },
  });
  const artPlaceholder = h('div', { className: 'np-art art-placeholder', attrs: { 'aria-hidden': 'true' } }, [
    icon('music'),
  ]);
  const title = h('h2', {
    className: 'np-title truncate',
    attrs: { id: 'np-title', 'data-tooltip-overflow': 'true' },
  });
  const artist = h('p', { className: 'np-artist truncate', attrs: { 'data-tooltip-overflow': 'true' } });
  const like = iconButton({
    icon: 'thumbs-up',
    label: 'Like',
    placement: 'top',
    attrs: { id: 'np-like', 'aria-pressed': 'false' },
    onClick: () => {
      actions.toggleLike();
    },
  });
  const dislike = iconButton({
    icon: 'thumbs-down',
    label: 'Dislike',
    placement: 'top',
    attrs: { id: 'np-dislike', 'aria-pressed': 'false' },
    onClick: () => {
      actions.toggleDislike();
    },
  });
  const currentTime = h('span', { className: 'time', text: '0:00' });
  const totalTime = h('span', { className: 'time', text: '0:00' });
  const progress = createProgressSlider(ctx, currentTime, 'np-progress');
  const shuffle = iconButton({
    icon: 'shuffle',
    label: 'Shuffle',
    placement: 'top',
    attrs: { 'aria-pressed': 'false' },
    onClick: () => {
      actions.toggleShuffle();
    },
  });
  const previous = iconButton({
    icon: 'skip-back',
    label: 'Previous',
    placement: 'top',
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
        id: 'np-play',
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
    onClick: () => {
      actions.next();
    },
  });
  const repeat = iconButton({
    icon: 'repeat',
    label: 'Repeat off',
    placement: 'top',
    attrs: { 'aria-pressed': 'false' },
    onClick: () => {
      actions.cycleRepeat();
    },
  });
  const mute = iconButton({
    icon: 'volume-2',
    label: 'Mute',
    placement: 'top',
    onClick: () => {
      actions.toggleMute();
    },
  });
  const volume = createVolumeSlider(ctx, 'np-volume');
  const queueButton = iconButton({
    icon: 'list-music',
    label: 'Show queue',
    placement: 'top',
    onClick: () => {
      overlays.close('nowplaying');
      overlays.open('queue', null).catch((error: unknown) => {
        console.warn('[nowplaying] queue failed', error);
      });
    },
  });
  const close = iconButton({
    icon: 'chevron-down',
    label: 'Close now playing',
    attrs: { id: 'np-close', 'data-autofocus': 'true' },
    onClick: () => {
      overlays.close('nowplaying');
    },
  });

  root.replaceChildren(
    h('div', { className: 'sheet-header' }, [
      close,
      h('h2', { className: 'panel-title', text: 'Now Playing' }),
      lyricsToggle(ctx, 'bottom', 'np-lyrics'),
      queueButton,
    ]),
    h('div', { className: 'sheet-body', attrs: { 'data-scroll': 'true' } }, [
      art,
      artPlaceholder,
      h('div', { className: 'np-meta' }, [
        h('div', { className: 'np-text' }, [title, artist]),
        dislike,
        like,
      ]),
      h('div', { className: 'np-controls' }, [
        h('div', { className: 'progress-row' }, [currentTime, progress.el, totalTime]),
        h('div', { className: 'np-transport' }, [shuffle, previous, play, next, repeat]),
        h('div', { className: 'progress-row' }, [mute, volume.el]),
      ]),
    ]),
  );
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Now Playing');
  hydrate(root);

  store.select(
    (state) => state.nowPlayingOpen,
    (open) => {
      root.dataset.open = open ? 'true' : 'false';
      if (open) {
        root.removeAttribute('inert');
      } else {
        root.setAttribute('inert', '');
      }
    },
  );

  store.select(
    (state) => ({ player: state.player, playing: displayedPlaying(state) }),
    ({ player, playing }) => {
      const labels = trackLabel(player);
      setText(title, labels.title === '' ? 'Loading' : labels.title);
      setText(artist, labels.artist);
      const artUrl = player && player.hasTrack && !player.isAd ? player.artworkUrl : '';
      setImage(art, artUrl, player ? `${player.title} cover art` : '');
      artPlaceholder.hidden = artUrl !== '';
      const disabled = !player || !player.hasTrack;
      setButtonIcon(play, playing ? 'pause' : 'play');
      setLabel(play, playing ? 'Pause' : 'Play');
      for (const button of [play, previous, next, shuffle, repeat]) {
        button.disabled = disabled;
      }
      const likeStatus = player ? player.likeStatus : 'INDIFFERENT';
      like.disabled = !player || !player.hasTrack || player.isAd;
      dislike.disabled = like.disabled;
      like.dataset.like = likeStatus;
      setAttr(like, 'aria-pressed', likeStatus === 'LIKE' ? 'true' : 'false');
      setAttr(dislike, 'aria-pressed', likeStatus === 'DISLIKE' ? 'true' : 'false');
      setAttr(shuffle, 'aria-pressed', player && player.shuffle ? 'true' : 'false');
      const repeatMode = player ? player.repeatMode : 'NONE';
      setButtonIcon(repeat, repeatMode === 'ONE' ? 'repeat-1' : 'repeat');
      setAttr(repeat, 'aria-pressed', repeatMode === 'NONE' ? 'false' : 'true');
      setLabel(
        repeat,
        repeatMode === 'ALL' ? 'Repeat all' : repeatMode === 'ONE' ? 'Repeat one' : 'Repeat off',
      );
      syncProgress(progress, currentTime, totalTime, player);
      const vol = player ? player.volume : 1;
      const muted = player ? player.isMuted : false;
      setButtonIcon(mute, volumeIconName(vol, muted));
      setLabel(mute, muted ? 'Unmute' : 'Mute');
      volume.setValue(muted ? 0 : vol);
    },
  );
}
