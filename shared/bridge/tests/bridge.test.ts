import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BridgeEvent } from '../src/contract';
import { installBridge, type MusixBridge } from '../src/index';

const PAGE = `
<ytmusic-app>
  <ytmusic-app-layout id="layout">
    <ytmusic-nav-bar><a class="sign-in-link" href="https://accounts.google.com/ServiceLogin">Sign in</a></ytmusic-nav-bar>
    <ytmusic-player-page>
      <div id="movie_player" class="html5-video-player">
        <video class="html5-main-video"></video>
        <a class="ytp-title-link" href="https://music.youtube.com/watch?v=lYBUbBu4W08&list=RDAMVMlYBUbBu4W08"></a>
      </div>
      <ytmusic-player-queue id="queue"><div id="contents"></div></ytmusic-player-queue>
    </ytmusic-player-page>
    <ytmusic-player-bar slot="player-bar" repeat-mode="NONE">
      <img class="image" src="https://lh3.googleusercontent.com/art=w60-h60-l90-rj" alt="" />
      <div class="content-info-wrapper">
        <span class="title">Never Gonna Give You Up</span>
        <span class="byline">Rick Astley • Whenever You Need Somebody • 1987</span>
      </div>
      <span class="time-info">0:00 / 3:34</span>
      <ytmusic-like-button-renderer id="like-button-renderer" like-status="INDIFFERENT">
        <div id="button-shape-like"><button aria-label="Like"></button></div>
        <div id="button-shape-dislike"><button aria-label="Dislike"></button></div>
      </ytmusic-like-button-renderer>
      <button class="previous-button"></button>
      <button id="play-pause-button"></button>
      <button class="next-button"></button>
      <button class="repeat"></button>
      <button class="shuffle"></button>
      <button class="volume"></button>
    </ytmusic-player-bar>
  </ytmusic-app-layout>
</ytmusic-app>`;

function fixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8');
}

interface FakeMedia {
  paused: boolean;
  currentTime: number;
  duration: number;
  readyState: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
}

interface Harness {
  events: BridgeEvent[];
  media: FakeMedia;
  video: HTMLVideoElement;
  player: Record<string, unknown>;
  calls: string[];
  fetchBodies: Record<string, unknown>[];
  lyricsUrls: string[];
  bridge: MusixBridge;
  config: Record<string, unknown>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(read: () => T | undefined, timeout = 3000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    await wait(20);
  }
  throw new Error('Timed out waiting for condition');
}

function setup(): Harness {
  document.body.innerHTML = PAGE;
  const events: BridgeEvent[] = [];
  const calls: string[] = [];
  const fetchBodies: Record<string, unknown>[] = [];
  const lyricsUrls: string[] = [];
  const media: FakeMedia = {
    paused: true,
    currentTime: 0,
    duration: 214,
    readyState: 4,
    volume: 1,
    muted: false,
    playbackRate: 1,
  };
  const video = document.querySelector('video') as HTMLVideoElement;
  for (const key of Object.keys(media) as (keyof FakeMedia)[]) {
    Object.defineProperty(video, key, {
      configurable: true,
      get: () => media[key],
      set: (value: never) => {
        (media as unknown as Record<string, unknown>)[key] = value;
        if (key === 'volume' || key === 'muted') {
          video.dispatchEvent(new Event('volumechange'));
        }
      },
    });
  }
  Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
  Object.defineProperty(video, 'buffered', {
    configurable: true,
    get: () => ({ length: 1, start: () => 0, end: () => Math.min(media.duration, media.currentTime + 30) }),
  });
  const state = { volume: 100, muted: false };
  const player = document.getElementById('movie_player') as unknown as Record<string, unknown>;
  Object.assign(player, {
    getVolume: () => state.volume,
    setVolume: (v: number) => {
      calls.push(`setVolume:${v}`);
      state.volume = v;
    },
    isMuted: () => state.muted,
    mute: () => {
      calls.push('mute');
      state.muted = true;
    },
    unMute: () => {
      calls.push('unMute');
      state.muted = false;
    },
    seekTo: (s: number) => {
      calls.push(`seekTo:${s}`);
      media.currentTime = s;
      video.dispatchEvent(new Event('seeked'));
    },
  });
  const bar = document.querySelector('ytmusic-player-bar') as HTMLElement;
  const click = (selector: string, handler: () => void): void => {
    document.querySelector(selector)?.addEventListener('click', () => {
      calls.push(`click:${selector}`);
      handler();
    });
  };
  click('#play-pause-button', () => {
    media.paused = !media.paused;
    video.dispatchEvent(new Event(media.paused ? 'pause' : 'play'));
  });
  click('.next-button', () => undefined);
  click('.previous-button', () => undefined);
  click('.shuffle', () => {
    if (bar.hasAttribute('shuffle-on')) {
      bar.removeAttribute('shuffle-on');
    } else {
      bar.setAttribute('shuffle-on', '');
    }
  });
  click('.repeat', () => {
    const next: Record<string, string> = { NONE: 'ALL', ALL: 'ONE', ONE: 'NONE' };
    bar.setAttribute('repeat-mode', next[bar.getAttribute('repeat-mode') ?? 'NONE'] ?? 'NONE');
  });
  click('#button-shape-like button', () => {
    const renderer = document.getElementById('like-button-renderer');
    renderer?.setAttribute(
      'like-status',
      renderer.getAttribute('like-status') === 'LIKE' ? 'INDIFFERENT' : 'LIKE',
    );
  });
  const queue = document.querySelector('#queue #contents') as HTMLElement;
  ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].forEach((id, index) => {
    const item = document.createElement('ytmusic-player-queue-item');
    if (index === 0) {
      item.setAttribute('selected', '');
    }
    (item as unknown as { data: unknown }).data = { videoId: id };
    item.innerHTML = `<ytmusic-play-button-renderer></ytmusic-play-button-renderer><span class="song-title">Track ${index}</span><span class="byline">Artist ${index}</span><span class="duration">3:0${index}</span>`;
    item.querySelector('ytmusic-play-button-renderer')?.addEventListener('click', () => {
      calls.push(`queue:${index}`);
    });
    queue.append(item);
  });
  const config: Record<string, unknown> = {
    INNERTUBE_CONTEXT: { client: { clientName: 'WEB_REMIX', clientVersion: '1.2' } },
    INNERTUBE_CONTEXT_CLIENT_NAME: 67,
    INNERTUBE_CLIENT_VERSION: '1.2',
    VISITOR_DATA: 'visitor',
    LOGGED_IN: false,
  };
  Object.assign(window, {
    ytcfg: { get: (key: string) => config[key] },
    AndroidBridge: {
      receive: (json: string) => {
        events.push(JSON.parse(json) as BridgeEvent);
      },
    },
    fetch: (url: string, init: RequestInit) => {
      if (url.startsWith('https://lrclib.net/api/')) {
        lyricsUrls.push(url);
        if (url.startsWith('https://lrclib.net/api/get')) {
          return Promise.resolve(new Response(fixture('lrclib-get'), { status: 200 }));
        }
        return Promise.resolve(new Response(fixture('lrclib-search'), { status: 200 }));
      }
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>;
      fetchBodies.push(body);
      if (url.includes('/music/get_search_suggestions')) {
        return Promise.resolve(new Response(fixture('search-suggestions'), { status: 200 }));
      }
      if (url.includes('/next')) {
        return Promise.resolve(new Response(fixture('lyrics-next'), { status: 200 }));
      }
      if (typeof body.browseId === 'string' && body.browseId.startsWith('MPLY')) {
        return Promise.resolve(new Response(fixture('lyrics-browse'), { status: 200 }));
      }
      if (url.includes('/playlist/get_add_to_playlist')) {
        return Promise.resolve(new Response(fixture('add-to-playlist'), { status: 200 }));
      }
      if (url.includes('/browse/edit_playlist')) {
        const status = body.playlistId === 'PLfails00' ? 'STATUS_FAILED' : 'STATUS_SUCCEEDED';
        return Promise.resolve(new Response(JSON.stringify({ status }), { status: 200 }));
      }
      if (url.includes('/like/')) {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      const endpoint = url.includes('/search') ? 'search' : 'browse';
      if (endpoint === 'search') {
        return Promise.resolve(new Response(fixture('search-songs'), { status: 200 }));
      }
      if (body.continuation !== undefined) {
        return Promise.resolve(new Response(fixture('browse-home-continuation'), { status: 200 }));
      }
      if (body.browseId === 'FEmusic_liked_playlists') {
        return Promise.resolve(new Response(fixture('browse-library-signed-out'), { status: 200 }));
      }
      return Promise.resolve(new Response(fixture('browse-home'), { status: 200 }));
    },
  });
  Object.defineProperty(window, 'crypto', { configurable: true, value: webcrypto });
  const bridge = installBridge(window, document);
  if (!bridge) {
    throw new Error('bridge not installed');
  }
  return { events, media, video, player, calls, fetchBodies, lyricsUrls, bridge, config };
}

function last<T extends BridgeEvent['type']>(
  h: Harness,
  type: T,
): Extract<BridgeEvent, { type: T }> | undefined {
  for (let i = h.events.length - 1; i >= 0; i -= 1) {
    const event = h.events[i];
    if (event && event.type === type) {
      return event as Extract<BridgeEvent, { type: T }>;
    }
  }
  return undefined;
}

let counter = 0;
function send(h: Harness, command: Record<string, unknown>): string {
  counter += 1;
  const requestId = `r${counter}`;
  h.bridge.receive(JSON.stringify({ v: 1, requestId, ...command }));
  return requestId;
}

async function ack(h: Harness, requestId: string): Promise<void> {
  await until(() =>
    h.events.find(
      (event) => (event.type === 'ack' || event.type === 'error') && event.requestId === requestId,
    ),
  );
  const result = h.events.find(
    (event) => (event.type === 'ack' || event.type === 'error') && event.requestId === requestId,
  );
  expect(result?.type, JSON.stringify(result)).toBe('ack');
}

describe('ytm bridge in a YouTube Music page', () => {
  let h: Harness;

  beforeEach(async () => {
    h = setup();
    await until(() => last(h, 'ready'));
    await until(() => last(h, 'state'));
  });

  afterEach(() => {
    h.bridge.dispose();
  });

  it('announces readiness and publishes the full state', () => {
    expect(last(h, 'ready')).toMatchObject({ platform: 'android', clientVersion: '1.2' });
    const state = last(h, 'state')?.state;
    expect(state).toMatchObject({
      videoId: 'lYBUbBu4W08',
      playlistId: 'RDAMVMlYBUbBu4W08',
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      album: 'Whenever You Need Somebody',
      durationSec: 214,
      isPlaying: false,
      volume: 1,
      isAd: false,
      isSignedIn: false,
      repeatMode: 'NONE',
    });
    expect(state?.artworkUrl).toBe('https://lh3.googleusercontent.com/art=w1200-h1200-l90-rj');
    expect(state?.bufferedSec).toBe(30);
  });

  it('publishes the queue with video ids', async () => {
    const queue = await until(() => last(h, 'queue'));
    expect(queue.items.map((item) => item.videoId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
    expect(queue.items[0]?.isCurrent).toBe(true);
    expect(queue.items[2]?.durationSec).toBe(182);
  });

  it('plays, pauses, and toggles with confirmation', async () => {
    await ack(h, send(h, { type: 'play' }));
    await until(() => (last(h, 'state')?.state.isPlaying ? true : undefined));
    await ack(h, send(h, { type: 'play' }));
    expect(h.calls.filter((call) => call === 'click:#play-pause-button').length).toBe(1);
    await ack(h, send(h, { type: 'pause' }));
    await until(() => (last(h, 'state')?.state.isPlaying === false ? true : undefined));
    await ack(h, send(h, { type: 'togglePlay' }));
    await until(() => (last(h, 'state')?.state.isPlaying ? true : undefined));
  });

  it('publishes the new playing state before acknowledging play and pause', async () => {
    const playId = send(h, { type: 'play' });
    await ack(h, playId);
    const playAck = h.events.findIndex((event) => event.type === 'ack' && event.requestId === playId);
    const beforePlay = h.events.slice(0, playAck).filter((event) => event.type === 'state');
    expect(beforePlay.at(-1)?.state.isPlaying).toBe(true);
    const pauseId = send(h, { type: 'pause' });
    await ack(h, pauseId);
    const pauseAck = h.events.findIndex((event) => event.type === 'ack' && event.requestId === pauseId);
    const beforePause = h.events.slice(0, pauseAck).filter((event) => event.type === 'state');
    expect(beforePause.at(-1)?.state.isPlaying).toBe(false);
  });

  it('resumes from the real media state even when the last report is stale', async () => {
    await ack(h, send(h, { type: 'play' }));
    h.media.paused = true;
    await ack(h, send(h, { type: 'play' }));
    expect(h.media.paused).toBe(false);
    h.media.paused = false;
    await ack(h, send(h, { type: 'togglePlay' }));
    expect(h.media.paused).toBe(true);
  });

  it('resumes playback the system paused while the app went to the background', async () => {
    await ack(h, send(h, { type: 'play' }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    h.media.paused = true;
    h.video.dispatchEvent(new Event('pause'));
    await until(() => (h.media.paused ? undefined : true));
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('keeps a deliberate pause when the app goes to the background', async () => {
    await ack(h, send(h, { type: 'play' }));
    await ack(h, send(h, { type: 'pause' }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    h.video.dispatchEvent(new Event('pause'));
    await wait(600);
    expect(h.media.paused).toBe(true);
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('ignores a still-watching prompt that is hidden', async () => {
    await ack(h, send(h, { type: 'play' }));
    const prompt = document.createElement('ytmusic-you-there-renderer');
    prompt.innerHTML =
      '<div class="buttons"><yt-button-renderer><button>Yes</button></yt-button-renderer></div>';
    prompt.querySelector('button')?.addEventListener('click', () => {
      h.calls.push('hidden-you-there');
    });
    const dialog = document.createElement('tp-yt-paper-dialog');
    dialog.setAttribute('aria-hidden', 'true');
    dialog.style.display = 'none';
    dialog.append(prompt);
    document.body.append(dialog);
    await wait(1300);
    await ack(h, send(h, { type: 'play' }));
    expect(h.calls).not.toContain('hidden-you-there');
    dialog.remove();
  });

  it('presses the page play button first so YouTube Music keeps its own state', async () => {
    const calls: string[] = [];
    Object.assign(h.player, {
      playVideo: () => {
        calls.push('playVideo');
      },
      pauseVideo: () => {
        calls.push('pauseVideo');
      },
    });
    await ack(h, send(h, { type: 'play' }));
    await ack(h, send(h, { type: 'pause' }));
    expect(calls).toEqual([]);
    expect(h.calls.filter((call) => call === 'click:#play-pause-button')).toHaveLength(2);
  });

  it('falls back to the player when the page button does not start playback', async () => {
    const calls: string[] = [];
    Object.assign(h.player, {
      playVideo: () => {
        calls.push('playVideo');
        h.media.paused = false;
        h.video.dispatchEvent(new Event('play'));
      },
    });
    const button = document.getElementById('play-pause-button') as HTMLElement;
    const blocked = button.cloneNode(true) as HTMLElement;
    button.replaceWith(blocked);
    await ack(h, send(h, { type: 'play' }));
    expect(calls).toEqual(['playVideo']);
    expect(h.media.paused).toBe(false);
  });

  it('answers the still-watching prompt and keeps playing', async () => {
    await ack(h, send(h, { type: 'play' }));
    const prompt = document.createElement('ytmusic-you-there-renderer');
    prompt.innerHTML =
      '<div class="buttons"><yt-button-renderer><button>Yes</button></yt-button-renderer></div>';
    const confirm = prompt.querySelector('button');
    confirm?.addEventListener('click', () => {
      h.calls.push('you-there');
      prompt.remove();
    });
    document.body.append(prompt);
    h.media.paused = true;
    h.video.dispatchEvent(new Event('pause'));
    await until(() => (h.calls.includes('you-there') && !h.media.paused ? true : undefined));
  });

  it('finds synced lyrics that match the track length', async () => {
    const id = send(h, {
      type: 'lyrics',
      videoId: 'J7p4bzqLvCw',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      album: 'After Hours',
      durationSec: 200.4,
    });
    const result = await until(() =>
      h.events.find(
        (event): event is Extract<BridgeEvent, { type: 'lyricsResult' }> =>
          event.type === 'lyricsResult' && event.requestId === id,
      ),
    );
    expect(result.lyrics?.synced).toBe(true);
    expect(result.lyrics?.source).toBe('LRCLIB');
    expect(result.lyrics?.lines[0]).toEqual({ timeMs: 13130, text: 'Yeah' });
    expect(h.lyricsUrls[0]).toContain('duration=200');
    await ack(h, id);
  });

  it('falls back to unsynced YouTube Music lyrics when no timing matches the track', async () => {
    const id = send(h, {
      type: 'lyrics',
      videoId: 'J7p4bzqLvCw',
      title: 'Blinding Lights (Official Video)',
      artist: 'The Weeknd',
      album: '',
      durationSec: 263 + 40,
    });
    const result = await until(() =>
      h.events.find(
        (event): event is Extract<BridgeEvent, { type: 'lyricsResult' }> =>
          event.type === 'lyricsResult' && event.requestId === id,
      ),
    );
    expect(result.lyrics?.synced).toBe(false);
    expect(result.lyrics?.source).toBe('Musixmatch');
    expect(result.lyrics?.lines[0]?.text).toBe('Yeah');
  });

  it('returns YouTube Music search suggestions', async () => {
    const id = send(h, { type: 'suggest', query: 'blinding li' });
    const result = await until(() =>
      h.events.find(
        (event): event is Extract<BridgeEvent, { type: 'suggestResult' }> =>
          event.type === 'suggestResult' && event.requestId === id,
      ),
    );
    expect(result.suggestions.queries).toContain('blinding lights the weeknd');
    expect(result.suggestions.items[0]).toMatchObject({ videoId: 'J7p4bzqLvCw', type: 'song' });
    expect(h.fetchBodies.at(-1)).toMatchObject({ input: 'blinding li' });
  });

  it('runs transport, seek, volume, mute, and like commands', async () => {
    await ack(h, send(h, { type: 'next' }));
    await ack(h, send(h, { type: 'previous' }));
    await ack(h, send(h, { type: 'seekTo', seconds: 30 }));
    await ack(h, send(h, { type: 'setVolume', volume: 0.4 }));
    await ack(h, send(h, { type: 'toggleMute' }));
    await ack(h, send(h, { type: 'toggleLike' }));
    expect(h.calls).toEqual(
      expect.arrayContaining([
        'click:.next-button',
        'click:.previous-button',
        'seekTo:30',
        'setVolume:40',
        'mute',
        'click:#button-shape-like button',
      ]),
    );
    await until(() => (last(h, 'state')?.state.likeStatus === 'LIKE' ? true : undefined));
    await until(() => (last(h, 'state')?.state.isMuted ? true : undefined));
  });

  it('sets shuffle and repeat to exact targets', async () => {
    await ack(h, send(h, { type: 'setShuffle', enabled: true }));
    await ack(h, send(h, { type: 'setShuffle', enabled: true }));
    expect(h.calls.filter((call) => call === 'click:.shuffle').length).toBe(1);
    await ack(h, send(h, { type: 'setRepeat', mode: 'ONE' }));
    await until(() => (last(h, 'state')?.state.repeatMode === 'ONE' ? true : undefined));
    await ack(h, send(h, { type: 'setRepeat', mode: 'NONE' }));
    await until(() => (last(h, 'state')?.state.repeatMode === 'NONE' ? true : undefined));
  });

  it('plays by video id and queue index', async () => {
    const navigations: unknown[] = [];
    document.querySelector('ytmusic-app')?.addEventListener('yt-navigate', (event) => {
      navigations.push((event as CustomEvent<unknown>).detail);
    });
    await ack(h, send(h, { type: 'playVideoId', videoId: 'IluRBvnYMoY', playlistId: 'OLAK5uy_abc' }));
    await ack(h, send(h, { type: 'playVideoId', videoId: '', playlistId: 'OLAK5uy_abc' }));
    expect(navigations).toEqual([
      { endpoint: { watchEndpoint: { videoId: 'IluRBvnYMoY', playlistId: 'OLAK5uy_abc' } } },
      { endpoint: { watchEndpoint: { playlistId: 'OLAK5uy_abc' } } },
    ]);
    await ack(h, send(h, { type: 'playQueueIndex', index: 2 }));
    expect(h.calls).toContain('queue:2');
    const missing = send(h, { type: 'playQueueIndex', index: 99 });
    await until(() => h.events.find((event) => event.type === 'error' && event.requestId === missing));
  });

  it('browses, searches, and pages through results', async () => {
    const browseId = send(h, { type: 'browse', nodeId: 'home' });
    const result = await until(() =>
      h.events.find((event) => event.type === 'browseResult' && event.requestId === browseId),
    );
    expect(result.type === 'browseResult' && result.page.sections[0]?.title).toBe('Quick picks');
    expect(h.fetchBodies.at(-1)).toMatchObject({
      browseId: 'FEmusic_home',
      context: { client: { clientName: 'WEB_REMIX' } },
    });
    const searchId = send(h, { type: 'search', query: 'daft punk', filter: 'songs' });
    const search = await until(() =>
      h.events.find((event) => event.type === 'searchResult' && event.requestId === searchId),
    );
    expect(search.type === 'searchResult' && search.page.sections[0]?.items.length).toBe(20);
    expect(h.fetchBodies.at(-1)).toMatchObject({ query: 'daft punk', params: expect.any(String) as unknown });
    const contId = send(h, { type: 'loadContinuation', token: 'tok', kind: 'browse', nodeId: 'home' });
    const page = await until(() =>
      h.events.find((event) => event.type === 'browseResult' && event.requestId === contId),
    );
    expect(page.type === 'browseResult' && page.page.nodeId).toBe('home');
    expect(h.fetchBodies.at(-1)).toMatchObject({ continuation: 'tok' });
  });

  it('reports signed-out library requests as not_signed_in', async () => {
    const id = send(h, { type: 'browse', nodeId: 'playlists' });
    const error = await until(() =>
      h.events.find((event) => event.type === 'error' && event.requestId === id),
    );
    expect(error).toMatchObject({ code: 'not_signed_in' });
  });

  it('rejects invalid commands', () => {
    expect(h.bridge.receive('{"v":1,"type":"eval","requestId":"x"}')).toBe(false);
    expect(last(h, 'error')).toMatchObject({ code: 'invalid_command' });
  });

  it('skips ads, reports adStart and adEnd, and restores playback settings', async () => {
    const bar = document.querySelector('ytmusic-player-bar') as HTMLElement;
    const player = document.getElementById('movie_player') as HTMLElement;
    const skip = document.createElement('button');
    skip.className = 'ytp-skip-ad-button';
    let skipped = 0;
    skip.addEventListener('click', () => {
      skipped += 1;
    });
    player.append(skip);
    bar.setAttribute('is-advertisement', '');
    player.classList.add('ad-showing');
    h.video.dispatchEvent(new Event('timeupdate'));
    await until(() => last(h, 'adStart'));
    expect(skipped).toBeGreaterThan(0);
    expect(h.media.muted).toBe(true);
    expect(h.media.playbackRate).toBe(16);
    expect(last(h, 'state')?.state.isAd).toBe(true);
    bar.removeAttribute('is-advertisement');
    player.classList.remove('ad-showing');
    skip.remove();
    h.video.dispatchEvent(new Event('timeupdate'));
    await until(() => last(h, 'adEnd'));
    expect(h.media.muted).toBe(false);
    expect(h.media.playbackRate).toBe(1);
  });

  it('jumps to the end of unskippable ads unless the fallback is disabled', async () => {
    await ack(h, send(h, { type: 'configure', adSkip: false }));
    const bar = document.querySelector('ytmusic-player-bar') as HTMLElement;
    bar.setAttribute('is-advertisement', '');
    h.media.currentTime = 1;
    h.video.dispatchEvent(new Event('timeupdate'));
    await until(() => last(h, 'adStart'));
    expect(h.media.currentTime).toBe(1);
    expect(h.media.muted).toBe(false);
    await ack(h, send(h, { type: 'configure', adSkip: true }));
    h.video.dispatchEvent(new Event('timeupdate'));
    await until(() => (h.media.currentTime === 214 ? true : undefined));
    expect(h.media.playbackRate).toBe(16);
  });

  it('ducks and restores the volume without touching the saved level', async () => {
    h.media.volume = 0.8;
    await ack(h, send(h, { type: 'duck', level: 0.2 }));
    expect(h.media.volume).toBeCloseTo(0.16);
    await ack(h, send(h, { type: 'duck', level: 1 }));
    expect(h.media.volume).toBeCloseTo(0.8);
    expect(h.calls.some((call) => call.startsWith('setVolume'))).toBe(false);
  });

  it('throttles progress updates to four per second', async () => {
    h.media.paused = false;
    h.video.dispatchEvent(new Event('play'));
    await wait(300);
    const before = h.events.filter((event) => event.type === 'state').length;
    for (let i = 0; i < 40; i += 1) {
      h.media.currentTime += 0.05;
      h.video.dispatchEvent(new Event('timeupdate'));
      await wait(25);
    }
    const sent = h.events.filter((event) => event.type === 'state').length - before;
    expect(sent).toBeGreaterThanOrEqual(2);
    expect(sent).toBeLessThanOrEqual(6);
  });

  it('refuses to save music while signed out', async () => {
    const id = send(h, { type: 'savePlaylist', playlistId: 'PLroadTrip001', save: true });
    const error = await until(() =>
      h.events.find((event) => event.type === 'error' && event.requestId === id),
    );
    expect(error).toMatchObject({ code: 'not_signed_in' });
  });

  it('emits signedIn with the avatar when the page signs in', async () => {
    h.config.LOGGED_IN = true;
    const nav = document.querySelector('ytmusic-nav-bar') as HTMLElement;
    nav.innerHTML =
      '<ytmusic-settings-button><img src="https://lh3.googleusercontent.com/a/avatar=s96-c" /></ytmusic-settings-button>';
    const signedIn = await until(() => last(h, 'signedIn'), 4000);
    expect(signedIn.avatarUrl).toBe('https://lh3.googleusercontent.com/a/avatar=s96-c');
    await until(() => (last(h, 'state')?.state.isSignedIn ? true : undefined));
  });

  it('lists playlists, adds songs, and saves playlists once signed in', async () => {
    h.config.LOGGED_IN = true;
    const nav = document.querySelector('ytmusic-nav-bar') as HTMLElement;
    nav.innerHTML =
      '<ytmusic-settings-button><img src="https://lh3.googleusercontent.com/a/x=s96-c" /></ytmusic-settings-button>';
    await until(() => (last(h, 'state')?.state.isSignedIn ? true : undefined), 4000);
    const listId = send(h, { type: 'playlistTargets', videoId: 'lYBUbBu4W08' });
    const result = await until(() =>
      h.events.find((event) => event.type === 'browseResult' && event.requestId === listId),
    );
    if (result.type !== 'browseResult') {
      throw new Error('expected a page');
    }
    expect(result.page.items.map((item) => [item.playlistId, item.title, item.subtitle])).toEqual([
      ['PLroadTrip001', 'Road trip', ''],
      ['PLfocusMix002', 'Focus mix', 'Already saved'],
    ]);
    expect(h.fetchBodies.at(-1)).toMatchObject({ videoIds: ['lYBUbBu4W08'] });
    await ack(h, send(h, { type: 'addToPlaylist', videoId: 'lYBUbBu4W08', playlistId: 'PLroadTrip001' }));
    expect(h.fetchBodies.at(-1)).toMatchObject({
      playlistId: 'PLroadTrip001',
      actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'lYBUbBu4W08' }],
    });
    const failed = send(h, { type: 'addToPlaylist', videoId: 'lYBUbBu4W08', playlistId: 'PLfails00' });
    await until(() => h.events.find((event) => event.type === 'error' && event.requestId === failed));
    await ack(h, send(h, { type: 'savePlaylist', playlistId: 'OLAK5uy_album', save: true }));
    expect(h.fetchBodies.at(-1)).toEqual(
      expect.objectContaining({ target: { playlistId: 'OLAK5uy_album' } }),
    );
    await ack(h, send(h, { type: 'savePlaylist', playlistId: 'OLAK5uy_album', save: false }));
  });

  it('installs only once', () => {
    expect(installBridge(window, document)).toBe(h.bridge);
  });
});
