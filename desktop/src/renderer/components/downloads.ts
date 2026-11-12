import { formatTime } from '../../shared/format';
import type { DownloadItem } from '../../shared/types';
import type { AppContext } from '../context';
import { h, hydrate, icon, iconButton, setAttr, setButtonIcon, setLabel, setText } from '../dom';
import { displayedPlaying } from '../state';

export function downloadTrackButton(
  ctx: AppContext,
  placement: 'top' | 'bottom',
  id: string,
): HTMLButtonElement {
  const { store, api, router, toasts, overlays } = ctx;
  const button = iconButton({
    icon: 'download',
    label: 'Download MP3',
    placement,
    className: 'icon-btn download-track-btn',
    attrs: { id, 'aria-pressed': 'false' },
    onClick: () => {
      const state = store.getState();
      const player = state.player;
      if (!player || !player.hasTrack || player.isAd || player.videoId === '') {
        return;
      }
      const existing = state.downloads.find((d) => d.videoId === player.videoId);
      if (existing && existing.status === 'completed') {
        if (state.nowPlayingOpen) {
          overlays.close('nowplaying');
        }
        router.openDownloads();
        return;
      }
      if (existing && existing.status === 'downloading') {
        return;
      }
      api
        .invoke('downloads:start', {
          videoId: player.videoId,
          title: player.title,
          artist: player.artist,
          album: player.album,
          durationSec: player.durationSec,
          artworkUrl: player.artworkUrl,
        })
        .then(() => {
          toasts.show({
            variant: 'info',
            title: 'Downloading MP3',
            message: player.title,
          });
        })
        .catch(() => {
          toasts.show({
            variant: 'error',
            title: 'Download failed',
            message: 'Could not start MP3 download.',
          });
        });
    },
  });

  store.select(
    (state) => {
      const player = state.player;
      const videoId = player && player.hasTrack && !player.isAd ? player.videoId : '';
      const entry = videoId !== '' ? (state.downloads.find((d) => d.videoId === videoId) ?? null) : null;
      return {
        disabled: videoId === '',
        status: entry ? entry.status : null,
        progress: entry ? Math.round(entry.progress * 100) : 0,
      };
    },
    ({ disabled, status, progress }) => {
      if (disabled) {
        button.disabled = true;
        button.dataset.status = 'idle';
        setAttr(button, 'aria-pressed', 'false');
        setButtonIcon(button, 'download');
        setLabel(button, 'Download MP3');
        return;
      }
      if (status === 'downloading') {
        button.disabled = true;
        button.dataset.status = 'downloading';
        setAttr(button, 'aria-pressed', 'false');
        setButtonIcon(button, 'loader-circle');
        setLabel(button, `Downloading MP3 (${progress}%)`);
        return;
      }
      if (status === 'completed') {
        button.disabled = false;
        button.dataset.status = 'completed';
        setAttr(button, 'aria-pressed', 'true');
        setButtonIcon(button, 'check');
        setLabel(button, 'Downloaded MP3');
        return;
      }
      button.disabled = false;
      button.dataset.status = 'idle';
      setAttr(button, 'aria-pressed', 'false');
      setButtonIcon(button, 'download');
      setLabel(button, 'Download MP3');
    },
  );

  return button;
}

function renderDownloadRow(
  item: DownloadItem,
  currentVideoId: string,
  playing: boolean,
  ctx: AppContext,
): HTMLElement {
  const { actions, api, toasts } = ctx;
  const isCurrent = item.videoId === currentVideoId;
  const isPlayingThis = isCurrent && playing;

  const thumbImg = h('img', {
    className: 'download-thumb',
    attrs: {
      src: item.artworkUrl,
      alt: `${item.title} thumbnail`,
      width: 56,
      height: 56,
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
    },
  });
  const thumbFallback = h(
    'div',
    { className: 'download-thumb art-placeholder', attrs: { 'aria-hidden': 'true' } },
    [icon('music')],
  );
  if (item.artworkUrl !== '') {
    thumbFallback.hidden = true;
    thumbImg.addEventListener(
      'error',
      () => {
        thumbImg.hidden = true;
        thumbFallback.hidden = false;
      },
      { once: true },
    );
  } else {
    thumbImg.hidden = true;
  }

  const descriptionParts = [item.artist, item.album].filter((part) => part.trim() !== '');
  const descriptionText = descriptionParts.length > 0 ? descriptionParts.join(' • ') : 'Offline MP3';

  let statusEl: HTMLElement;
  if (item.status === 'downloading') {
    const pct = Math.round(item.progress * 100);
    const fill = h('div', { className: 'download-progress-fill' });
    fill.style.width = `${pct}%`;
    statusEl = h('div', { className: 'download-meta' }, [
      h('span', { className: 'download-status-text', text: `Downloading MP3 • ${pct}%` }),
      h('div', { className: 'download-progress-bar' }, [fill]),
    ]);
  } else if (item.status === 'failed') {
    statusEl = h('div', { className: 'download-meta' }, [
      h('span', {
        className: 'download-status-error',
        text: item.error ?? 'Download failed',
      }),
    ]);
  } else {
    statusEl = h('div', { className: 'download-meta' }, [
      h('span', { className: 'badge', text: 'MP3' }),
      h('span', { className: 'download-duration', text: formatTime(item.durationSec) }),
    ]);
  }

  const actionNodes: HTMLElement[] = [];
  if (item.status === 'completed') {
    const playBtn = iconButton({
      icon: isPlayingThis ? 'pause' : 'play',
      label: isPlayingThis ? `Pause ${item.title}` : `Play ${item.title}`,
      placement: 'top',
      className: 'icon-btn download-play-btn',
      onClick: () => {
        if (isCurrent && actions.isOfflineActive()) {
          actions.togglePlay();
          return;
        }
        actions.playDownloaded(item);
      },
    });
    actionNodes.push(playBtn);
  } else if (item.status === 'failed') {
    const retryBtn = iconButton({
      icon: 'refresh-cw',
      label: `Retry ${item.title}`,
      placement: 'top',
      onClick: () => {
        api
          .invoke('downloads:start', {
            videoId: item.videoId,
            title: item.title,
            artist: item.artist,
            album: item.album,
            durationSec: item.durationSec,
            artworkUrl: item.artworkUrl,
          })
          .catch(() => {
            toasts.show({
              variant: 'error',
              title: 'Download failed',
              message: 'Could not restart MP3 download.',
            });
          });
      },
    });
    actionNodes.push(retryBtn);
  }

  const deleteBtn = iconButton({
    icon: 'trash-2',
    label: `Delete ${item.title}`,
    placement: 'top',
    onClick: () => {
      if (isCurrent && actions.isOfflineActive()) {
        actions.stopOffline();
      }
      api
        .invoke('downloads:delete', item.videoId)
        .then(() => {
          toasts.show({
            variant: 'info',
            title: 'Removed download',
            message: item.title,
          });
        })
        .catch(() => undefined);
    },
  });
  actionNodes.push(deleteBtn);

  const row = h(
    'div',
    {
      className: 'download-card',
      dataset: { current: isCurrent ? 'true' : 'false', status: item.status },
      on: {
        dblclick: () => {
          if (item.status === 'completed') {
            actions.playDownloaded(item);
          }
        },
      },
    },
    [
      h('div', { className: 'download-thumb-wrap' }, [thumbImg, thumbFallback]),
      h('div', { className: 'download-info' }, [
        h('div', { className: 'download-title truncate', text: item.title }),
        h('div', { className: 'download-desc truncate', text: descriptionText }),
        statusEl,
      ]),
      h('div', { className: 'download-actions' }, actionNodes),
    ],
  );
  return row;
}

export function mountDownloads(root: HTMLElement, ctx: AppContext): void {
  const { store, router } = ctx;

  const subtitle = h('p', {
    className: 'settings-subtitle',
    text: 'Play your downloaded MP3 tracks offline.',
  });
  const closeBtn = iconButton({
    icon: 'x',
    label: 'Close downloads',
    attrs: { id: 'downloads-close' },
    onClick: () => {
      router.closeDownloads();
    },
  });

  const listContainer = h('div', { className: 'downloads-list' });
  const inner = h('div', { className: 'settings-inner downloads-inner' }, [
    h('div', { className: 'settings-header' }, [
      h('div', {}, [h('h1', { className: 'settings-title', text: 'Downloads' }), subtitle]),
      closeBtn,
    ]),
    listContainer,
  ]);

  root.replaceChildren(inner);
  root.setAttribute('aria-label', 'Downloads');
  hydrate(root);

  store.select(
    (state) => state.downloadsOpen,
    (open) => {
      root.hidden = !open;
    },
  );

  let lastSignature = '';
  store.select(
    (state) => ({
      downloads: state.downloads,
      currentVideoId: state.player && state.player.hasTrack ? state.player.videoId : '',
      playing: displayedPlaying(state),
    }),
    ({ downloads, currentVideoId, playing }) => {
      const completedCount = downloads.filter((d) => d.status === 'completed').length;
      setText(
        subtitle,
        completedCount === 1
          ? '1 MP3 track saved for offline playback.'
          : `${completedCount} MP3 tracks saved for offline playback.`,
      );
      const signature = JSON.stringify({
        items: downloads.map((d) => [d.videoId, d.status, Math.round(d.progress * 100), d.artworkUrl]),
        currentVideoId,
        playing,
      });
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;

      if (downloads.length === 0) {
        const empty = h('div', { className: 'downloads-empty' }, [
          h('span', { className: 'state-icon' }, [icon('download')]),
          h('h2', { text: 'No downloads yet' }),
          h('p', {
            text: 'Use the download button on any playing song to save its MP3, thumbnail, and description for offline listening.',
          }),
        ]);
        listContainer.replaceChildren(empty);
        hydrate(listContainer);
        return;
      }

      const rows = downloads.map((item) => renderDownloadRow(item, currentVideoId, playing, ctx));
      listContainer.replaceChildren(...rows);
      hydrate(listContainer);
    },
  );
}
