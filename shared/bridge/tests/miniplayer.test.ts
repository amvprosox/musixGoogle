import { afterEach, describe, expect, it } from 'vitest';
import type { BridgeEvent } from '../src/contract';
import { readLikeStatus, readRepeat, readShuffle } from '../src/dom';
import { installBridge, type MusixBridge } from '../src/index';

const PAGE = `
<ytmusic-app>
  <ytmusic-app-layout>
    <ytmusic-player-page>
      <div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video></div>
    </ytmusic-player-page>
    <ytmusic-miniplayer slot="player-bar">
      <ytmusic-track-info>
        <img class="ytmusicTrackInfoThumbnail" src="https://yt3.googleusercontent.com/art=w60-h60-l90-rj" alt="" />
        <div class="ytmusicTrackInfoTitle"><span>Never Gonna Give You Up</span></div>
        <div class="ytmusicTrackInfoByline"><span><a>Rick Astley</a> • <a>Whenever You Need Somebody</a> • 1987</span></div>
      </ytmusic-track-info>
      <ytmusic-wiz-player-controls>
        <div client-ve-type="45468"><button aria-pressed="true" aria-label="Shuffle"></button></div>
        <div client-ve-type="36840"><button aria-label="Previous"></button></div>
        <div client-ve-type="54213"><button aria-label="Play"></button></div>
        <div client-ve-type="36841"><button aria-label="Next"></button></div>
        <div client-ve-type="51548"><button aria-pressed="true" aria-label="Repeat one"></button></div>
      </ytmusic-wiz-player-controls>
      <div class="ytMusicMiniPlayerTimeInfo">0:08 / 3:34</div>
      <like-button-view-model><button aria-pressed="true"></button></like-button-view-model>
      <dislike-button-view-model><button aria-pressed="false"></button></dislike-button-view-model>
    </ytmusic-miniplayer>
  </ytmusic-app-layout>
</ytmusic-app>`;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the redesigned YouTube Music player bar', () => {
  let bridge: MusixBridge | null = null;

  afterEach(() => {
    bridge?.dispose();
    bridge = null;
    document.body.innerHTML = '';
  });

  it('reads like, shuffle and repeat from the new controls', () => {
    document.body.innerHTML = PAGE;
    const bar = document.querySelector('ytmusic-miniplayer');
    expect(bar).not.toBeNull();
    if (!bar) {
      return;
    }
    expect(readLikeStatus(bar)).toBe('LIKE');
    expect(readShuffle(bar)).toBe(true);
    expect(readRepeat(bar)).toBe('ONE');
    bar.querySelector('[client-ve-type="51548"] button')?.setAttribute('aria-label', 'Repeat all');
    expect(readRepeat(bar)).toBe('ALL');
    bar.querySelector('[client-ve-type="51548"] button')?.setAttribute('aria-pressed', 'false');
    expect(readRepeat(bar)).toBe('NONE');
  });

  it('becomes ready and reports the track and plays through the new bar', async () => {
    document.body.innerHTML = PAGE;
    const events: BridgeEvent[] = [];
    const clicks: string[] = [];
    document.querySelector('[client-ve-type="54213"] button')?.addEventListener('click', () => {
      clicks.push('play');
    });
    Object.assign(window, {
      ytcfg: { get: () => undefined },
      AndroidBridge: {
        receive: (json: string) => {
          events.push(JSON.parse(json) as BridgeEvent);
        },
      },
    });
    bridge = installBridge(window, document);
    const started = Date.now();
    while (!events.some((event) => event.type === 'ready') && Date.now() - started < 3000) {
      await wait(20);
    }
    await wait(50);
    const state = [...events].reverse().find((event) => event.type === 'state');
    expect(state?.type).toBe('state');
    if (state?.type !== 'state') {
      return;
    }
    expect(state.state.title).toBe('Never Gonna Give You Up');
    expect(state.state.artworkUrl.startsWith('https://yt3.googleusercontent.com/')).toBe(true);
    expect(state.state.durationSec).toBe(214);
    expect(state.state.shuffle).toBe(true);
    expect(state.state.repeatMode).toBe('ONE');
    expect(state.state.likeStatus).toBe('LIKE');
    bridge?.receive(JSON.stringify({ v: 1, requestId: 'm1', type: 'togglePlay' }));
    await wait(50);
    expect(clicks).toEqual(['play']);
  });
});
