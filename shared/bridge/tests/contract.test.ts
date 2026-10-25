import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRIDGE_VERSION, EMPTY_STATE, type BridgeEvent } from '../src/contract';
import { parseLrc } from '../src/lyrics';
import { parseBrowseResponse, parseQueueResponse, parseSuggestions } from '../src/parse';
import { isBridgeEvent } from '../src/validate';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const CONTRACT = path.join(import.meta.dirname, 'contract');
const UPDATE = process.env.UPDATE_CONTRACT === '1';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as unknown;
}

const BROWSE: Record<string, string> = {
  'browse-album': 'MPREb_contract',
  'browse-artist': 'UCcontract',
  'browse-explore': 'explore',
  'browse-home': 'home',
  'browse-home-continuation': 'home',
  'browse-moods': 'FEmusic_moods_and_genres',
  'browse-playlist': 'VLPLcontract',
  'browse-playlist-continuation': 'VLPLcontract',
};

const SEARCH = ['search-all', 'search-songs', 'search-albums', 'search-playlists'];

function events(): Record<string, BridgeEvent> {
  const out: Record<string, BridgeEvent> = {};
  for (const [name, nodeId] of Object.entries(BROWSE)) {
    out[`browseResult-${name}`] = {
      v: BRIDGE_VERSION,
      type: 'browseResult',
      requestId: 'n1',
      page: parseBrowseResponse(fixture(name), nodeId),
    };
  }
  for (const name of SEARCH) {
    const filter = name.replace('search-', '');
    out[`searchResult-${name}`] = {
      v: BRIDGE_VERSION,
      type: 'searchResult',
      requestId: 'n2',
      query: 'contract',
      page: parseBrowseResponse(fixture(name), `search:${filter}:contract`),
    };
  }
  out['queue-next-watch'] = {
    v: BRIDGE_VERSION,
    type: 'queue',
    items: parseQueueResponse(fixture('next-watch')).map((item, index) => ({
      index,
      videoId: item.videoId ?? '',
      title: item.title,
      artist: item.subtitle,
      artworkUrl: item.artworkUrl,
      durationSec: item.durationSec ?? 0,
      isCurrent: index === 0,
    })),
  };
  out['state-playing'] = {
    v: BRIDGE_VERSION,
    type: 'state',
    state: {
      ...EMPTY_STATE,
      videoId: 'lYBUbBu4W08',
      playlistId: 'RDAMVMlYBUbBu4W08',
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      album: 'Whenever You Need Somebody',
      artworkUrl: 'https://lh3.googleusercontent.com/contract=w544-h544-l90-rj',
      durationSec: 213,
      positionSec: 42.5,
      bufferedSec: 60,
      isPlaying: true,
      volume: 0.8,
      likeStatus: 'LIKE',
      shuffle: true,
      repeatMode: 'ALL',
      isSignedIn: true,
    },
  };
  out['state-ad'] = {
    v: BRIDGE_VERSION,
    type: 'state',
    state: { ...EMPTY_STATE, isAd: true, isPlaying: true },
  };
  out['ready'] = { v: BRIDGE_VERSION, type: 'ready', platform: 'android', clientVersion: '1.20261015.01.00' };
  out['signedIn'] = { v: BRIDGE_VERSION, type: 'signedIn', avatarUrl: 'https://yt3.ggpht.com/contract' };
  out['signedOut'] = { v: BRIDGE_VERSION, type: 'signedOut' };
  out['adStart'] = { v: BRIDGE_VERSION, type: 'adStart' };
  out['adEnd'] = { v: BRIDGE_VERSION, type: 'adEnd' };
  out['ack'] = { v: BRIDGE_VERSION, type: 'ack', requestId: 'n3' };
  out['lyricsResult-synced'] = {
    v: BRIDGE_VERSION,
    type: 'lyricsResult',
    requestId: 'n5',
    lyrics: {
      videoId: 'J7p4bzqLvCw',
      source: 'LRCLIB',
      synced: true,
      instrumental: false,
      lines: parseLrc("[00:13.13] Yeah\n[00:16.56] ♪\n[00:27.16] I've been tryna call"),
    },
  };
  out['lyricsResult-none'] = { v: BRIDGE_VERSION, type: 'lyricsResult', requestId: 'n6', lyrics: null };
  out['suggestResult'] = {
    v: BRIDGE_VERSION,
    type: 'suggestResult',
    requestId: 'n7',
    suggestions: parseSuggestions(fixture('search-suggestions'), 'blinding li'),
  };
  out['error-signed-out'] = {
    v: BRIDGE_VERSION,
    type: 'error',
    code: 'not_signed_in',
    message: 'Sign in to see this content',
    requestId: 'n4',
  };
  out['error-global'] = {
    v: BRIDGE_VERSION,
    type: 'error',
    code: 'network',
    message: 'Offline',
    requestId: null,
  };
  return out;
}

describe('cross-platform contract files', () => {
  it('match the parser output and validate', () => {
    if (UPDATE) {
      mkdirSync(CONTRACT, { recursive: true });
    }
    for (const [name, event] of Object.entries(events())) {
      expect(isBridgeEvent(event), name).toBe(true);
      const file = path.join(CONTRACT, `${name}.json`);
      const text = `${JSON.stringify(event, null, 2)}\n`;
      if (UPDATE) {
        writeFileSync(file, text);
      }
      expect(existsSync(file), `${name} is missing; run with UPDATE_CONTRACT=1`).toBe(true);
      expect(readFileSync(file, 'utf8'), name).toBe(text);
    }
  });

  it('cover non-empty pages for every browse and search fixture', () => {
    for (const [name, event] of Object.entries(events())) {
      if (event.type === 'browseResult' || event.type === 'searchResult') {
        const count =
          event.page.items.length + event.page.sections.reduce((sum, s) => sum + s.items.length, 0);
        expect(count, name).toBeGreaterThan(0);
      }
    }
  });
});
