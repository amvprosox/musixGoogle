(function () {
  'use strict';
  const tracks = [
    {
      id: 'trk0000001a',
      title: 'Signal Fire',
      artist: 'The Testers',
      album: 'Fixtures Vol 1',
      duration: '2:00',
    },
    {
      id: 'trk0000002b',
      title: 'Night Bus',
      artist: 'Mock Orchestra',
      album: 'Fixtures Vol 1',
      duration: '2:00',
    },
    {
      id: 'trk0000003c',
      title: 'Paper Planes Over Lisbon In The Late Afternoon Light',
      artist: 'Stub Collective',
      album: 'Long Titles',
      duration: '2:00',
    },
    { id: 'trk0000004d', title: 'Quiet Hours', artist: 'Harness', album: 'Fixtures Vol 2', duration: '2:00' },
    {
      id: 'trk0000005e',
      title: 'Last Call',
      artist: 'The Testers',
      album: 'Fixtures Vol 2',
      duration: '2:00',
    },
  ];
  const routes = {
    FEmusic_home: '/',
    FEmusic_explore: '/explore',
    FEmusic_library_landing: '/library',
    VLLM: '/browse/VLLM',
    FEmusic_liked_playlists: '/library/playlists',
  };
  const titles = {
    '/': 'Home',
    '/explore': 'Explore',
    '/library': 'Library',
    '/browse/VLLM': 'Liked music',
    '/library/playlists': 'Playlists',
  };
  const q = (s) => document.querySelector(s);
  const app = q('ytmusic-app');
  const bar = q('ytmusic-player-bar');
  const mp = q('#movie_player');
  const video = q('video');
  const queue = q('#queue #contents');
  const state = {
    index: -1,
    volume: 100,
    muted: false,
    ad: false,
    volumeListeners: [],
    adRequests: 0,
    menuOpened: 0,
  };
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  };

  const nativeAdd = EventTarget.prototype.addEventListener;
  mp.addEventListener = function (type, fn, options) {
    if (type === 'onVolumeChange') {
      state.volumeListeners.push(fn);
      return;
    }
    return nativeAdd.call(this, type, fn, options);
  };
  const fireVolume = () => {
    for (const fn of state.volumeListeners) fn({ volume: state.volume, muted: state.muted });
  };
  mp.getVolume = () => state.volume;
  mp.setVolume = (v) => {
    state.volume = Math.max(0, Math.min(100, Math.round(v)));
    video.volume = state.volume / 100;
    fireVolume();
  };
  mp.isMuted = () => state.muted;
  mp.mute = () => {
    state.muted = true;
    video.muted = true;
    fireVolume();
  };
  mp.unMute = () => {
    state.muted = false;
    video.muted = false;
    fireVolume();
  };
  mp.seekTo = (seconds) => {
    video.currentTime = seconds;
  };

  function menuFor(track) {
    return {
      menuRenderer: {
        items: [
          {
            menuServiceItemRenderer: {
              text: { runs: [{ text: 'Play next' }] },
              serviceEndpoint: {
                queueAddEndpoint: {
                  queueTarget: { videoId: track.id },
                  queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO',
                },
              },
            },
          },
          {
            menuServiceItemRenderer: {
              text: { runs: [{ text: 'Add to queue' }] },
              serviceEndpoint: {
                queueAddEndpoint: {
                  queueTarget: { videoId: track.id },
                  queueInsertPosition: 'INSERT_AT_END',
                },
              },
            },
          },
          {
            menuNavigationItemRenderer: {
              text: { runs: [{ text: 'Go to album' }] },
              navigationEndpoint: {
                browseEndpoint: {
                  browseId: 'MPREb_fixture',
                  browseEndpointContextSupportedConfigs: {
                    browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' },
                  },
                },
              },
            },
          },
          {
            menuNavigationItemRenderer: {
              text: { runs: [{ text: 'Go to artist' }] },
              navigationEndpoint: {
                browseEndpoint: {
                  browseId: 'UCfixture',
                  browseEndpointContextSupportedConfigs: {
                    browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' },
                  },
                },
              },
            },
          },
        ],
      },
    };
  }

  function renderQueue() {
    queue.replaceChildren();
    tracks.forEach((track, i) => {
      const item = document.createElement('ytmusic-player-queue-item');
      item.data = { videoId: track.id, menu: menuFor(track) };
      if (i === state.index) item.setAttribute('selected', '');
      const img = document.createElement('img');
      img.className = 'thumbnail';
      const info = document.createElement('div');
      info.className = 'song-info';
      const title = document.createElement('yt-formatted-string');
      title.className = 'song-title';
      title.textContent = track.title;
      const byline = document.createElement('yt-formatted-string');
      byline.className = 'byline';
      byline.textContent = track.artist;
      info.append(title, byline);
      const duration = document.createElement('yt-formatted-string');
      duration.className = 'duration';
      duration.textContent = track.duration;
      const play = document.createElement('ytmusic-play-button-renderer');
      play.addEventListener('click', (event) => {
        event.stopPropagation();
        load(i, true);
      });
      item.append(play, img, info, duration);
      queue.append(item);
    });
  }

  function setMetadata(title, artist, album) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album, artwork: [] });
    } catch (error) {
      console.warn('mediaSession unavailable', error);
    }
  }

  function load(index, autoplay) {
    state.index = ((index % tracks.length) + tracks.length) % tracks.length;
    const track = tracks[state.index];
    video.src = '/media/track.wav';
    video.playbackRate = 1;
    q('.content-info-wrapper .title').textContent = track.title;
    q('.content-info-wrapper .byline').textContent = track.artist + ' • ' + track.album + ' • 2026';
    q('.ytp-title-link').setAttribute('href', location.origin + '/watch?v=' + track.id);
    q('#like-button-renderer').setAttribute('like-status', 'INDIFFERENT');
    setMetadata(track.title, track.artist, track.album);
    renderQueue();
    if (autoplay) {
      video.play().catch((error) => console.warn('play rejected', error));
    }
  }

  function setPage(path) {
    q('#page-title').textContent = titles[path] || (path.startsWith('/search') ? 'Search' : 'Page');
    q('#page-path').textContent = path;
  }

  nativeAdd.call(app, 'yt-navigate', (event) => {
    const endpoint = event.detail && event.detail.endpoint;
    if (!endpoint) return;
    let path = null;
    if (endpoint.browseEndpoint && routes[endpoint.browseEndpoint.browseId]) {
      path = routes[endpoint.browseEndpoint.browseId];
    }
    if (endpoint.watchEndpoint) {
      const index = tracks.findIndex((t) => t.id === endpoint.watchEndpoint.videoId);
      history.pushState({}, '', '/watch?v=' + endpoint.watchEndpoint.videoId);
      load(index < 0 ? 0 : index, true);
      return;
    }
    if (endpoint.searchEndpoint) {
      path = '/search?q=' + encodeURIComponent(endpoint.searchEndpoint.query).replace(/%20/g, '+');
    }
    if (path) {
      history.pushState({}, '', path);
      setPage(path);
    }
  });
  window.addEventListener('popstate', () => setPage(location.pathname + location.search));

  q('#play-pause-button').addEventListener('click', () => {
    if (state.index < 0) return;
    if (video.paused) {
      video.play().catch((error) => console.warn('play rejected', error));
    } else {
      video.pause();
    }
  });
  q('.next-button').addEventListener('click', () => load(state.index + 1, true));
  q('.previous-button').addEventListener('click', () => {
    if (video.currentTime > 3) {
      video.currentTime = 0;
      return;
    }
    load(state.index - 1, true);
  });
  q('.shuffle').addEventListener('click', () => {
    if (bar.hasAttribute('shuffle-on')) bar.removeAttribute('shuffle-on');
    else bar.setAttribute('shuffle-on', '');
  });
  q('.repeat').addEventListener('click', () => {
    const next = { NONE: 'ALL', ALL: 'ONE', ONE: 'NONE' }[bar.getAttribute('repeat-mode') || 'NONE'];
    bar.setAttribute('repeat-mode', next);
  });
  q('.volume').addEventListener('click', () => (state.muted ? mp.unMute() : mp.mute()));
  q('#button-shape-like button').addEventListener('click', () => {
    const r = q('#like-button-renderer');
    r.setAttribute('like-status', r.getAttribute('like-status') === 'LIKE' ? 'INDIFFERENT' : 'LIKE');
  });
  q('#button-shape-dislike button').addEventListener('click', () => {
    const r = q('#like-button-renderer');
    r.setAttribute('like-status', r.getAttribute('like-status') === 'DISLIKE' ? 'INDIFFERENT' : 'DISLIKE');
  });
  video.addEventListener('timeupdate', () => {
    q('.time-info').textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
  });
  video.addEventListener('ended', () => {
    if (state.ad) {
      endAd();
      return;
    }
    if (bar.getAttribute('repeat-mode') === 'ONE') {
      video.currentTime = 0;
      video.play().catch(() => undefined);
      return;
    }
    load(state.index + 1, true);
  });

  function endAd() {
    if (!state.ad) return;
    state.ad = false;
    bar.removeAttribute('is-advertisement');
    mp.classList.remove('ad-showing');
    const skip = q('.ytp-skip-ad-button');
    if (skip) skip.remove();
    load(state.index < 0 ? 0 : state.index, true);
  }

  state.commands = [];
  app.resolveCommand = (command) => {
    state.commands.push(command);
    if (command && command.watchEndpoint) {
      const index = tracks.findIndex((t) => t.id === command.watchEndpoint.videoId);
      load(index < 0 ? 0 : index, true);
    }
    if (command && command.browseEndpoint) {
      history.pushState({}, '', '/browse/' + command.browseEndpoint.browseId);
      setPage(location.pathname);
    }
    return true;
  };

  const carousel = q('#fixture-carousel #items');
  for (let i = 0; i < 14; i += 1) {
    const li = document.createElement('li');
    li.textContent = 'Card ' + (i + 1);
    carousel.append(li);
  }
  const list = q('#fixture-list');
  tracks.slice(0, 3).forEach((track, i) => {
    const row = document.createElement('ytmusic-responsive-list-item-renderer');
    row.className = 'fixture-item';
    row.setAttribute('data-row', String(i));
    row.data = { playlistItemData: { videoId: track.id }, menu: menuFor(track) };
    const title = document.createElement('span');
    title.className = 'title';
    title.setAttribute('title', track.title);
    title.textContent = track.title;
    const like = document.createElement('ytmusic-like-button-renderer');
    like.innerHTML =
      '<div id="button-shape-like"><button aria-label="Like" title="Like this">Like</button></div>';
    like.querySelector('button').addEventListener('click', () => {
      state.rowLikes = (state.rowLikes || 0) + 1;
    });
    row.append(title, like);
    list.append(row);
  });

  window.__fixture = {
    commands() {
      return state.commands.map((command) => JSON.stringify(command));
    },
    rowLikes() {
      return state.rowLikes || 0;
    },
    tracks,
    play(index) {
      load(index, true);
      return true;
    },
    startAd(withSkip) {
      state.ad = true;
      bar.setAttribute('is-advertisement', '');
      mp.classList.add('ad-showing');
      q('.content-info-wrapper .title').textContent = 'Sponsored message';
      setMetadata('Sponsored message', 'Advertiser', '');
      video.src = '/media/ad.wav';
      video.play().catch(() => undefined);
      if (withSkip) {
        const skip = document.createElement('button');
        skip.className = 'ytp-skip-ad-button';
        skip.textContent = 'Skip';
        skip.addEventListener('click', () => {
          state.skipClicks = (state.skipClicks || 0) + 1;
          endAd();
        });
        mp.append(skip);
      }
      return true;
    },
    adState() {
      return {
        ad: state.ad,
        skipClicks: state.skipClicks || 0,
        muted: video.muted,
        rate: video.playbackRate,
      };
    },
    requestAd() {
      state.adRequests += 1;
      const img = new Image();
      img.src = 'https://pagead2.googlesyndication.com/pagead/show_ads.js?fixture=' + Date.now();
      return fetch('https://googleads.g.doubleclick.net/pagead/id?fixture=' + Date.now(), { mode: 'no-cors' })
        .then(() => 'loaded')
        .catch(() => 'failed');
    },
    signIn(avatar) {
      const link = q('a.sign-in-link');
      if (link) link.remove();
      const button = document.createElement('ytmusic-settings-button');
      const img = document.createElement('img');
      img.src = avatar;
      button.append(img);
      button.addEventListener('click', () => {
        state.menuOpened += 1;
      });
      q('ytmusic-nav-bar').append(button);
      return true;
    },
    clearQueue() {
      queue.replaceChildren();
      return true;
    },
    menuOpened() {
      return state.menuOpened;
    },
    status() {
      return {
        index: state.index,
        paused: video.paused,
        currentTime: video.currentTime,
        volume: state.volume,
        muted: state.muted,
        like: q('#like-button-renderer').getAttribute('like-status'),
        shuffle: bar.hasAttribute('shuffle-on'),
        repeat: bar.getAttribute('repeat-mode'),
        path: location.pathname + location.search,
      };
    },
  };

  setPage(location.pathname + location.search);
  renderQueue();
  const watch = new URLSearchParams(location.search).get('v');
  if (location.pathname === '/watch' && watch) {
    const index = tracks.findIndex((t) => t.id === watch);
    load(index < 0 ? 0 : index, true);
  }
})();
