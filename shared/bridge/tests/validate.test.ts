import { describe, expect, it } from 'vitest';
import { EMPTY_STATE } from '../src/contract';
import { isBridgeCommand, isBridgeEvent, parseBridgeCommand, parseBridgeEvent } from '../src/validate';

describe('bridge command validation', () => {
  const base = { v: 1, requestId: 'r1' };
  it('accepts every documented command', () => {
    const commands = [
      { type: 'play' },
      { type: 'pause' },
      { type: 'togglePlay' },
      { type: 'next' },
      { type: 'previous' },
      { type: 'seekTo', seconds: 12 },
      { type: 'setVolume', volume: 0.5 },
      { type: 'toggleMute' },
      { type: 'toggleLike' },
      { type: 'toggleDislike' },
      { type: 'setShuffle', enabled: true },
      { type: 'setRepeat', mode: 'ONE' },
      { type: 'playVideoId', videoId: 'lYBUbBu4W08', playlistId: null },
      { type: 'playVideoId', videoId: 'lYBUbBu4W08', playlistId: 'RDAMVMlYBUbBu4W08' },
      { type: 'playVideoId', videoId: '', playlistId: 'OLAK5uy_abc' },
      { type: 'playlistTargets', videoId: 'lYBUbBu4W08' },
      { type: 'addToPlaylist', videoId: 'lYBUbBu4W08', playlistId: 'PLroadTrip001' },
      { type: 'savePlaylist', playlistId: 'OLAK5uy_abc', save: false },
      { type: 'playQueueIndex', index: 3 },
      { type: 'browse', nodeId: 'home' },
      { type: 'search', query: 'daft punk', filter: 'songs' },
      { type: 'loadContinuation', token: 'abc', kind: 'browse', nodeId: 'home' },
      { type: 'configure', adSkip: false },
      { type: 'duck', level: 0.2 },
    ];
    for (const command of commands) {
      expect(isBridgeCommand({ ...base, ...command }), command.type).toBe(true);
    }
  });

  it('rejects malformed commands', () => {
    const bad = [
      { type: 'play' },
      { ...base, v: 2, type: 'play' },
      { ...base, requestId: '', type: 'play' },
      { ...base, type: 'seekTo', seconds: -1 },
      { ...base, type: 'setVolume', volume: 1.5 },
      { ...base, type: 'setRepeat', mode: 'SOMETIMES' },
      { ...base, type: 'playVideoId', videoId: '<script>', playlistId: null },
      { ...base, type: 'playVideoId', videoId: 'lYBUbBu4W08', playlistId: 'bad list' },
      { ...base, type: 'playVideoId', videoId: '', playlistId: null },
      { ...base, type: 'playlistTargets', videoId: 'x' },
      { ...base, type: 'addToPlaylist', videoId: 'lYBUbBu4W08', playlistId: 'bad id' },
      { ...base, type: 'savePlaylist', playlistId: 'PLx1', save: 'yes' },
      { ...base, type: 'playQueueIndex', index: 1.5 },
      { ...base, type: 'search', query: '  ', filter: 'all' },
      { ...base, type: 'search', query: 'x', filter: 'podcasts' },
      { ...base, type: 'loadContinuation', token: 'a', kind: 'next', nodeId: 'x' },
      { ...base, type: 'duck', level: 2 },
      { ...base, type: 'eval' },
    ];
    for (const command of bad) {
      expect(isBridgeCommand(command), JSON.stringify(command)).toBe(false);
    }
    expect(parseBridgeCommand('not json')).toBeNull();
    expect(parseBridgeCommand(JSON.stringify({ ...base, type: 'next' }))).toEqual({ ...base, type: 'next' });
  });
});

describe('bridge event validation', () => {
  it('accepts valid events', () => {
    const events = [
      { v: 1, type: 'ready', platform: 'android', clientVersion: '1.2' },
      { v: 1, type: 'state', state: EMPTY_STATE },
      {
        v: 1,
        type: 'queue',
        items: [
          {
            index: 0,
            videoId: 'a',
            title: 't',
            artist: 'r',
            artworkUrl: '',
            durationSec: 1,
            isCurrent: true,
          },
        ],
      },
      {
        v: 1,
        type: 'browseResult',
        requestId: 'r',
        page: { nodeId: 'home', title: '', sections: [], items: [], continuation: null },
      },
      {
        v: 1,
        type: 'searchResult',
        requestId: 'r',
        query: 'q',
        page: { nodeId: 'x', title: '', sections: [], items: [], continuation: null },
      },
      { v: 1, type: 'signedIn', avatarUrl: '' },
      { v: 1, type: 'signedOut' },
      { v: 1, type: 'adStart' },
      { v: 1, type: 'adEnd' },
      { v: 1, type: 'ack', requestId: 'r' },
      { v: 1, type: 'error', code: 'network', message: 'x', requestId: null },
    ];
    for (const event of events) {
      expect(isBridgeEvent(event), event.type).toBe(true);
    }
  });

  it('rejects invalid events', () => {
    expect(
      isBridgeEvent({ v: 1, type: 'state', state: { ...EMPTY_STATE, artworkUrl: 'http://insecure' } }),
    ).toBe(false);
    expect(isBridgeEvent({ v: 1, type: 'state', state: { ...EMPTY_STATE, volume: 3 } })).toBe(false);
    expect(isBridgeEvent({ v: 0, type: 'adStart' })).toBe(false);
    expect(isBridgeEvent({ v: 1, type: 'error', code: 'boom', message: 'x', requestId: null })).toBe(false);
    expect(isBridgeEvent({ v: 1, type: 'unknown' })).toBe(false);
    expect(parseBridgeEvent('{')).toBeNull();
  });
});
