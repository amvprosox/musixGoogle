import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bestThumbnail,
  endpointOf,
  isSignedOutResponse,
  parseBrowseResponse,
  parseClock,
  parseItemRenderer,
  parseQueueResponse,
  textOf,
  upgradeArtwork,
} from '../src/parse';
import { isBrowsePage } from '../src/validate';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'),
  ) as unknown;
}

const ALL = [
  'browse-album',
  'browse-artist',
  'browse-explore',
  'browse-home',
  'browse-home-continuation',
  'browse-library-signed-out',
  'browse-moods',
  'browse-playlist',
  'browse-playlist-continuation',
  'next-watch',
  'search-albums',
  'search-all',
  'search-playlists',
  'search-songs',
];

describe('youtubei response parsing', () => {
  it('parses the home page into titled shelves with a continuation', () => {
    const page = parseBrowseResponse(fixture('browse-home'), 'home');
    expect(page.sections.length).toBeGreaterThanOrEqual(2);
    expect(page.sections[0]?.title).toBe('Quick picks');
    expect(
      page.sections[0]?.items.every((item) => item.type === 'song' && item.playable && item.videoId !== null),
    ).toBe(true);
    expect(page.continuation).not.toBeNull();
  });

  it('parses home continuations', () => {
    const page = parseBrowseResponse(fixture('browse-home-continuation'), 'home');
    expect(page.sections.length).toBeGreaterThanOrEqual(2);
    expect(page.sections.every((section) => section.title !== '' && section.items.length > 0)).toBe(true);
  });

  it('parses an album page with tracks, durations, and inherited artwork', () => {
    const page = parseBrowseResponse(fixture('browse-album'), 'MPREb_eMBjPmWySjR');
    expect(page.title).toBe('Random Access Memories');
    expect(page.items.length).toBe(13);
    const first = page.items[0];
    expect(first?.type).toBe('song');
    expect(first?.durationSec).toBe(276);
    expect(first?.artworkUrl.startsWith('https://')).toBe(true);
    expect(first?.playlistId).toMatch(/^OLAK5uy_/);
  });

  it('parses a playlist with 100 tracks and a continuation', () => {
    const page = parseBrowseResponse(fixture('browse-playlist'), 'VLPLtest');
    expect(page.items.length).toBe(100);
    expect(page.continuation).not.toBeNull();
    expect(page.items.every((item) => item.playable && item.videoId !== null)).toBe(true);
    expect(new Set(page.items.map((item) => item.id)).size).toBe(page.items.length);
  });

  it('parses an artist page into typed shelves', () => {
    const page = parseBrowseResponse(fixture('browse-artist'), 'UC_test');
    expect(page.title).toBe('Daft Punk');
    const albums = page.sections.find((section) => section.title === 'Albums');
    expect(albums?.items.every((item) => item.type === 'album' && item.browsable)).toBe(true);
    const songs = page.sections.find((section) => section.title === 'Top songs');
    expect(songs?.items.every((item) => item.type === 'song')).toBe(true);
  });

  it('parses moods and genres as browsable shelves', () => {
    const page = parseBrowseResponse(fixture('browse-moods'), 'FEmusic_moods_and_genres');
    const items = page.sections.flatMap((section) => section.items);
    expect(items.length).toBeGreaterThan(20);
    expect(items.every((item) => item.type === 'shelf' && item.browsable && item.browseId !== null)).toBe(
      true,
    );
  });

  it('parses all-results search into a top result and typed items', () => {
    const page = parseBrowseResponse(fixture('search-all'), 'search:all:daft punk');
    expect(page.sections[0]?.title).toBe('Top result');
    expect(page.sections[0]?.items[0]?.type).toBe('artist');
    const types = new Set(page.items.map((item) => item.type));
    for (const type of ['song', 'album', 'playlist', 'artist']) {
      expect(types.has(type as never)).toBe(true);
    }
  });

  it('parses filtered searches with continuations', () => {
    const songs = parseBrowseResponse(fixture('search-songs'), 'search:songs:daft punk');
    expect(songs.sections[0]?.items.length).toBe(20);
    expect(songs.sections[0]?.items.every((item) => item.type === 'song' && item.durationSec !== null)).toBe(
      true,
    );
    expect(songs.continuation).not.toBeNull();
    const albums = parseBrowseResponse(fixture('search-albums'), 'search:albums:ram');
    expect(albums.sections[0]?.items.every((item) => item.type === 'album')).toBe(true);
    const playlists = parseBrowseResponse(fixture('search-playlists'), 'search:playlists:top hits');
    expect(
      playlists.sections[0]?.items.every((item) => item.type === 'playlist' && item.playlistId !== null),
    ).toBe(true);
  });

  it('parses the watch queue from the next endpoint', () => {
    const queue = parseQueueResponse(fixture('next-watch'));
    expect(queue.length).toBe(50);
    expect(queue[0]?.videoId).toBe('lYBUbBu4W08');
    expect(queue[0]?.durationSec).toBe(214);
  });

  it('detects signed-out responses', () => {
    expect(isSignedOutResponse(fixture('browse-library-signed-out'))).toBe(true);
    const page = parseBrowseResponse(fixture('browse-library-signed-out'), 'playlists');
    expect(page.items).toEqual([]);
    expect(page.sections).toEqual([]);
  });

  it('produces pages that pass the shared validator for every fixture', () => {
    for (const name of ALL) {
      expect(isBrowsePage(parseBrowseResponse(fixture(name), name)), name).toBe(true);
    }
  });

  it('only emits https artwork', () => {
    for (const name of ALL) {
      const page = parseBrowseResponse(fixture(name), name);
      for (const item of [...page.items, ...page.sections.flatMap((section) => section.items)]) {
        expect(
          item.artworkUrl === '' || item.artworkUrl.startsWith('https://'),
          `${name}: ${item.artworkUrl}`,
        ).toBe(true);
      }
    }
  });
});

describe('parser tolerance', () => {
  it('returns empty pages for garbage input', () => {
    for (const input of [
      null,
      undefined,
      42,
      'text',
      [],
      {},
      { contents: 5 },
      { contents: { x: [null, 1, 'a'] } },
    ]) {
      const page = parseBrowseResponse(input, 'x');
      expect(page.items).toEqual([]);
      expect(page.sections).toEqual([]);
    }
  });

  it('skips unknown renderer types and items with missing fields', () => {
    expect(parseItemRenderer({ musicFutureRenderer: { title: 'x' } })).toBeNull();
    expect(parseItemRenderer({ musicTwoRowItemRenderer: {} })).toBeNull();
    expect(parseItemRenderer({ musicResponsiveListItemRenderer: { flexColumns: 'nope' } })).toBeNull();
    expect(
      parseItemRenderer({ musicTwoRowItemRenderer: { title: { runs: [{ text: 'No endpoint' }] } } }),
    ).toBeNull();
  });

  it('never throws when random keys are removed from real responses', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const mutate = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.filter(() => random() > 0.05).map(mutate);
      }
      if (typeof value === 'object' && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
          if (random() < 0.08) {
            continue;
          }
          out[key] = random() < 0.02 ? 'unexpected' : mutate(child);
        }
        return out;
      }
      return value;
    };
    for (const name of ALL) {
      for (let round = 0; round < 5; round += 1) {
        const mutated = mutate(fixture(name));
        expect(() => parseBrowseResponse(mutated, name)).not.toThrow();
        expect(isBrowsePage(parseBrowseResponse(mutated, name))).toBe(true);
        expect(() => parseQueueResponse(mutated)).not.toThrow();
      }
    }
  });
});

describe('parsing helpers', () => {
  it('reads text runs', () => {
    expect(textOf({ runs: [{ text: 'A' }, { text: ' • ' }, { text: 'B' }] })).toBe('A • B');
    expect(textOf({ simpleText: ' x ' })).toBe('x');
    expect(textOf(null)).toBe('');
  });

  it('parses clock durations', () => {
    expect(parseClock('3:34')).toBe(214);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('54M plays')).toBeNull();
  });

  it('upgrades artwork to the highest resolution', () => {
    expect(upgradeArtwork('https://lh3.googleusercontent.com/abc=w60-h60-l90-rj')).toBe(
      'https://lh3.googleusercontent.com/abc=w544-h544-l90-rj',
    );
    expect(upgradeArtwork('https://yt3.ggpht.com/abc=s88-c-k')).toBe('https://yt3.ggpht.com/abc=s544');
    expect(upgradeArtwork('http://insecure.example/a.jpg')).toBe('');
    expect(
      bestThumbnail({
        thumbnails: [
          { url: 'https://i.ytimg.com/a.jpg', width: 10 },
          { url: 'https://i.ytimg.com/b.jpg', width: 20 },
        ],
      }),
    ).toBe('https://i.ytimg.com/b.jpg');
  });

  it('classifies endpoints', () => {
    expect(endpointOf({ watchEndpoint: { videoId: 'abcdefghijk' } })).toMatchObject({
      kind: 'watch',
      videoId: 'abcdefghijk',
    });
    expect(endpointOf({ watchPlaylistEndpoint: { playlistId: 'PL1' } })).toMatchObject({
      kind: 'watchPlaylist',
      playlistId: 'PL1',
    });
    expect(endpointOf({ browseEndpoint: { browseId: 'MPREb_x' } })).toMatchObject({
      kind: 'browse',
      browseId: 'MPREb_x',
    });
    expect(endpointOf({})).toBeNull();
  });
});
