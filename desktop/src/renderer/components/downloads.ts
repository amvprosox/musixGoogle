import { formatTime } from '../../shared/format';
import type { DetectedLibrary, DownloadItem } from '../../shared/types';
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
        toasts.show({
          variant: 'info',
          title: 'Already downloaded',
          message: player.title,
        });
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
        setLabel(button, 'Already downloaded');
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

function renderLibraryCard(lib: DetectedLibrary, downloads: DownloadItem[], ctx: AppContext): HTMLElement {
  const { api, toasts } = ctx;
  const completedSet = new Set(downloads.filter((d) => d.status === 'completed').map((d) => d.videoId));
  const downloadingSet = new Set(downloads.filter((d) => d.status === 'downloading').map((d) => d.videoId));
  const total = lib.tracks.length;
  let completedCount = 0;
  let downloadingCount = 0;
  for (const track of lib.tracks) {
    if (completedSet.has(track.videoId)) {
      completedCount += 1;
    } else if (downloadingSet.has(track.videoId)) {
      downloadingCount += 1;
    }
  }
  const allCompleted = total > 0 && completedCount === total;
  const remaining = Math.max(0, total - completedCount);

  const thumbImg = h('img', {
    className: 'download-thumb',
    attrs: {
      src: lib.artworkUrl,
      alt: `${lib.title} thumbnail`,
      width: 48,
      height: 48,
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
    },
  });
  const thumbFallback = h(
    'div',
    { className: 'download-thumb art-placeholder', attrs: { 'aria-hidden': 'true' } },
    [icon('library')],
  );
  if (lib.artworkUrl !== '') {
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

  let btnText = 'Download All';
  if (allCompleted) {
    btnText = 'Already Downloaded';
  } else if (downloadingCount > 0) {
    btnText = `Downloading (${completedCount}/${total})`;
  } else if (completedCount > 0) {
    btnText = `Download (${remaining} left)`;
  }

  const actionBtn = h(
    'button',
    {
      className: allCompleted ? 'btn btn-secondary download-lib-btn' : 'btn btn-primary download-lib-btn',
      attrs: { type: 'button' },
      dataset: { status: allCompleted ? 'completed' : 'idle' },
      on: {
        click: () => {
          if (allCompleted) {
            toasts.show({
              variant: 'info',
              title: 'Already downloaded',
              message: `All ${total} songs in ${lib.title} are already downloaded.`,
            });
            return;
          }
          api
            .invoke('downloads:batch', { title: lib.title, tracks: lib.tracks })
            .then((res) => {
              if (res.alreadyDownloaded) {
                toasts.show({
                  variant: 'info',
                  title: 'Already downloaded',
                  message: `All ${res.total} songs in ${lib.title} are already downloaded.`,
                });
              } else {
                toasts.show({
                  variant: 'info',
                  title: `Downloading ${lib.title}`,
                  message:
                    res.skipped > 0
                      ? `Downloading ${res.started} song(s), skipped ${res.skipped} already downloaded.`
                      : `Downloading ${res.started} song(s).`,
                });
              }
            })
            .catch(() => {
              toasts.show({
                variant: 'error',
                title: 'Library download failed',
                message: `Could not start download for ${lib.title}.`,
              });
            });
        },
      },
    },
    [icon(allCompleted ? 'check' : 'download'), h('span', { text: btnText })],
  );

  return h('div', { className: 'download-card download-lib-card' }, [
    h('div', { className: 'download-thumb-wrap' }, [thumbImg, thumbFallback]),
    h('div', { className: 'download-info' }, [
      h('div', { className: 'download-title truncate', text: lib.title }),
      h('div', {
        className: 'download-desc truncate',
        text: `${lib.subtitle} • ${completedCount}/${total} downloaded`,
      }),
    ]),
    h('div', { className: 'download-actions' }, [actionBtn]),
  ]);
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
      h('span', {
        className: 'download-status-text',
        text: item.progress <= 0 ? 'Queued...' : `Downloading MP3 • ${pct}%`,
      }),
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
  const { store, router, api, toasts } = ctx;

  let searchQuery = '';
  let logsOpen = false;
  let logsList: string[] = [];
  let librariesList: DetectedLibrary[] = [];
  let librariesLoading = false;
  let librariesLoadedOnce = false;

  const subtitle = h('p', {
    className: 'settings-subtitle',
    text: 'Play your downloaded MP3 tracks offline.',
  });

  const logsBody = h('pre', {
    className: 'downloads-logs-body',
    text: 'No download logs yet.',
  });

  const copyLogsBtn = h(
    'button',
    {
      className: 'btn btn-ghost btn-sm',
      attrs: { type: 'button' },
      on: {
        click: () => {
          const text = logsList.join('\n');
          navigator.clipboard
            .writeText(text)
            .then(() => {
              toasts.show({
                variant: 'success',
                title: 'Copied logs',
                message: `${logsList.length} lines copied to clipboard.`,
              });
            })
            .catch(() => undefined);
        },
      },
    },
    [icon('copy'), h('span', { text: 'Copy' })],
  );

  const clearLogsBtn = h(
    'button',
    {
      className: 'btn btn-ghost btn-sm',
      attrs: { type: 'button' },
      on: {
        click: () => {
          api
            .invoke('downloads:logs-clear', null)
            .then(() => {
              logsList = [];
              renderLogs();
            })
            .catch(() => undefined);
        },
      },
    },
    [icon('trash-2'), h('span', { text: 'Clear' })],
  );

  const logsPanel = h('div', { className: 'downloads-logs-panel', attrs: { hidden: true } }, [
    h('div', { className: 'downloads-logs-header' }, [
      h('span', {
        className: 'downloads-section-title',
        text: 'Download Logs (downloads/misc/downloads.log)',
      }),
      h('div', { className: 'downloads-logs-actions' }, [copyLogsBtn, clearLogsBtn]),
    ]),
    logsBody,
  ]);

  function renderLogs(): void {
    setText(logsBody, logsList.length > 0 ? logsList.join('\n') : 'No download logs yet.');
    logsBody.scrollTop = logsBody.scrollHeight;
  }

  const logsToggleBtn = h(
    'button',
    {
      className: 'btn btn-ghost btn-sm downloads-logs-toggle',
      attrs: { type: 'button', 'aria-expanded': 'false' },
      on: {
        click: () => {
          logsOpen = !logsOpen;
          logsPanel.hidden = !logsOpen;
          setAttr(logsToggleBtn, 'aria-expanded', logsOpen ? 'true' : 'false');
          if (logsOpen) {
            renderLogs();
          }
        },
      },
    },
    [icon('info'), h('span', { text: 'Logs' })],
  );

  const closeBtn = iconButton({
    icon: 'x',
    label: 'Close downloads',
    attrs: { id: 'downloads-close' },
    onClick: () => {
      router.closeDownloads();
    },
  });

  const searchInput = h('input', {
    className: 'downloads-search-input',
    attrs: {
      type: 'search',
      placeholder: 'Search downloads and libraries...',
      'aria-label': 'Search downloads and libraries',
    },
    on: {
      input: () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        clearSearchBtn.hidden = searchQuery === '';
        renderAll(true);
      },
    },
  });

  const clearSearchBtn = iconButton({
    icon: 'x',
    label: 'Clear search',
    className: 'downloads-search-clear',
    onClick: () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.hidden = true;
      renderAll(true);
    },
  });
  clearSearchBtn.hidden = true;

  const searchBar = h('div', { className: 'downloads-search' }, [
    icon('search'),
    searchInput,
    clearSearchBtn,
  ]);

  const refreshLibsBtn = h(
    'button',
    {
      className: 'btn btn-ghost btn-sm',
      attrs: { type: 'button' },
      on: {
        click: () => {
          fetchLibraries(true);
        },
      },
    },
    [icon('refresh-cw'), h('span', { text: 'Refresh' })],
  );

  const downloadAllLibsBtn = h(
    'button',
    {
      className: 'btn btn-ghost btn-sm download-lib-btn',
      attrs: { type: 'button' },
      on: {
        click: () => {
          const seenIds = new Set<string>();
          const allTracks = librariesList
            .flatMap((lib) => lib.tracks)
            .filter((track) => {
              if (seenIds.has(track.videoId)) {
                return false;
              }
              seenIds.add(track.videoId);
              return true;
            });
          if (allTracks.length === 0) {
            return;
          }
          api
            .invoke('downloads:batch', {
              title: 'All Libraries',
              tracks: allTracks,
            })
            .then((res) => {
              if (res.alreadyDownloaded) {
                toasts.show({
                  variant: 'info',
                  title: 'Already downloaded',
                  message: `All ${res.total} songs across your libraries are already downloaded.`,
                });
              } else {
                const skipNote = res.skipped > 0 ? ` (skipped ${res.skipped} already downloaded)` : '';
                toasts.show({
                  variant: 'info',
                  title: 'Downloading all libraries',
                  message: `Queued ${res.started} songs${skipNote}.`,
                });
              }
            })
            .catch(() => {
              toasts.show({
                variant: 'error',
                title: 'Batch download failed',
                message: 'Could not start downloading libraries.',
              });
            });
        },
      },
    },
    [icon('download'), h('span', { text: 'Download All Libraries' })],
  );

  const librariesListContainer = h('div', { className: 'downloads-list downloads-libraries-list' });
  const librariesSection = h('div', { className: 'downloads-section' }, [
    h('div', { className: 'downloads-section-header' }, [
      h('span', { className: 'downloads-section-title', text: 'Auto-Detected Libraries' }),
      h('div', { className: 'downloads-section-actions' }, [refreshLibsBtn, downloadAllLibsBtn]),
    ]),
    librariesListContainer,
  ]);

  const tracksSectionTitle = h('span', {
    className: 'downloads-section-title',
    text: 'Downloaded Tracks',
  });
  const listContainer = h('div', { className: 'downloads-list' });
  const tracksSection = h('div', { className: 'downloads-section' }, [
    h('div', { className: 'downloads-section-header' }, [tracksSectionTitle]),
    listContainer,
  ]);

  const inner = h('div', { className: 'settings-inner downloads-inner' }, [
    h('div', { className: 'settings-header' }, [
      h('div', {}, [h('h1', { className: 'settings-title', text: 'Downloads' }), subtitle]),
      h('div', { className: 'downloads-header-actions' }, [logsToggleBtn, closeBtn]),
    ]),
    searchBar,
    logsPanel,
    librariesSection,
    tracksSection,
  ]);

  root.replaceChildren(inner);
  root.setAttribute('aria-label', 'Downloads');
  hydrate(root);

  function fetchLibraries(force: boolean): void {
    if (librariesLoading || (librariesLoadedOnce && !force)) {
      return;
    }
    librariesLoading = true;
    renderLibraries(store.getState().downloads);
    api
      .invoke('downloads:libraries', null)
      .then((libs) => {
        librariesList = libs;
        librariesLoadedOnce = true;
      })
      .catch(() => undefined)
      .finally(() => {
        librariesLoading = false;
        renderLibraries(store.getState().downloads);
      });
  }

  function renderLibraries(downloads: DownloadItem[]): void {
    const filteredLibs = librariesList.filter((lib) => {
      if (searchQuery === '') {
        return true;
      }
      if (lib.title.toLowerCase().includes(searchQuery) || lib.subtitle.toLowerCase().includes(searchQuery)) {
        return true;
      }
      return lib.tracks.some(
        (t) =>
          t.title.toLowerCase().includes(searchQuery) ||
          t.artist.toLowerCase().includes(searchQuery) ||
          t.album.toLowerCase().includes(searchQuery),
      );
    });

    downloadAllLibsBtn.hidden = librariesList.length === 0;

    if (librariesLoading && librariesList.length === 0) {
      const loadingEl = h('div', { className: 'downloads-lib-empty' }, [
        h('span', { text: 'Detecting your YouTube Music libraries...' }),
      ]);
      librariesListContainer.replaceChildren(loadingEl);
      return;
    }

    if (filteredLibs.length === 0) {
      const emptyMsg =
        searchQuery !== ''
          ? 'No libraries match your search.'
          : 'No libraries detected yet. Click Refresh after signing in.';
      const emptyEl = h('div', { className: 'downloads-lib-empty' }, [h('span', { text: emptyMsg })]);
      librariesListContainer.replaceChildren(emptyEl);
      return;
    }

    const cards = filteredLibs.map((lib) => renderLibraryCard(lib, downloads, ctx));
    librariesListContainer.replaceChildren(...cards);
    hydrate(librariesListContainer);
  }

  api
    .invoke('downloads:logs', null)
    .then((initialLogs) => {
      logsList = initialLogs;
      renderLogs();
    })
    .catch(() => undefined);

  api.on('downloads:logs-changed', (nextLogs) => {
    logsList = nextLogs;
    if (logsOpen) {
      renderLogs();
    }
  });

  store.select(
    (state) => state.downloadsOpen,
    (open) => {
      root.hidden = !open;
      if (open) {
        fetchLibraries(false);
      }
    },
  );

  let lastSignature = '';
  function renderAll(force = false): void {
    const state = store.getState();
    const downloads = state.downloads;
    const currentVideoId = state.player && state.player.hasTrack ? state.player.videoId : '';
    const playing = displayedPlaying(state);

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
      searchQuery,
      libCount: librariesList.length,
    });
    if (!force && signature === lastSignature) {
      return;
    }
    lastSignature = signature;

    renderLibraries(downloads);

    const filteredDownloads = downloads.filter((item) => {
      if (searchQuery === '') {
        return true;
      }
      return (
        item.title.toLowerCase().includes(searchQuery) ||
        item.artist.toLowerCase().includes(searchQuery) ||
        item.album.toLowerCase().includes(searchQuery)
      );
    });

    setText(
      tracksSectionTitle,
      searchQuery !== ''
        ? `Downloaded Tracks (${filteredDownloads.length}/${downloads.length})`
        : `Downloaded Tracks (${downloads.length})`,
    );

    if (filteredDownloads.length === 0) {
      const empty = h('div', { className: 'downloads-empty' }, [
        h('span', { className: 'state-icon' }, [icon('download')]),
        h('h2', { text: searchQuery !== '' ? 'No matching downloads' : 'No downloads yet' }),
        h('p', {
          text:
            searchQuery !== ''
              ? 'Try a different search term.'
              : 'Use the download button on any playing song or library above to save MP3s, thumbnails, and descriptions for offline listening.',
        }),
      ]);
      listContainer.replaceChildren(empty);
      hydrate(listContainer);
      return;
    }

    const rows = filteredDownloads.map((item) => renderDownloadRow(item, currentVideoId, playing, ctx));
    listContainer.replaceChildren(...rows);
    hydrate(listContainer);
  }

  store.select(
    (state) => ({
      downloads: state.downloads,
      currentVideoId: state.player && state.player.hasTrack ? state.player.videoId : '',
      playing: displayedPlaying(state),
    }),
    () => {
      renderAll(false);
    },
  );
}
