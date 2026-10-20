import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cookieValue, innertube, InnertubeError, sapisidHash, type PageConfig } from '../src/innertube';

const config: PageConfig = {
  context: { client: { clientName: 'WEB_REMIX' } },
  clientName: '67',
  clientVersion: '1.2',
  visitorData: 'VD',
  loggedIn: true,
};

describe('innertube client', () => {
  it('computes SAPISIDHASH like YouTube', async () => {
    const expected = createHash('sha1').update('1700000000 abc123 https://music.youtube.com').digest('hex');
    expect(
      await sapisidHash(
        'abc123',
        'https://music.youtube.com',
        1700000000,
        webcrypto.subtle as unknown as SubtleCrypto,
      ),
    ).toBe(`SAPISIDHASH 1700000000_${expected}`);
  });

  it('reads cookies', () => {
    expect(cookieValue('a=1; SAPISID=xyz%2F; b=2', 'SAPISID')).toBe('xyz/');
    expect(cookieValue('a=1', 'SAPISID')).toBeNull();
  });

  it('sends the page context and auth headers', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchStub = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }) as unknown as typeof fetch;
    const result = await innertube(
      'browse',
      { browseId: 'FEmusic_home' },
      {
        fetch: fetchStub,
        config,
        cookie: 'SAPISID=secret',
        origin: 'https://music.youtube.com',
        subtle: webcrypto.subtle as unknown as SubtleCrypto,
        now: () => 1700000000000,
      },
    );
    expect(result).toEqual({ ok: true });
    const call = calls[0];
    expect(call?.url).toBe('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^SAPISIDHASH 1700000000_[0-9a-f]{40}$/);
    expect(headers['x-goog-visitor-id']).toBe('VD');
    expect(JSON.parse(typeof call?.init.body === 'string' ? call.init.body : '{}')).toEqual({
      context: config.context,
      browseId: 'FEmusic_home',
    });
  });

  it('omits auth when signed out and maps failures to typed errors', async () => {
    const ok = ((_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toBeUndefined();
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
    const deps = {
      config,
      cookie: '',
      origin: 'https://music.youtube.com',
      subtle: webcrypto.subtle as unknown as SubtleCrypto,
      now: () => 0,
    };
    await innertube('search', { query: 'x' }, { ...deps, fetch: ok });
    const httpFail = (() => Promise.resolve(new Response('no', { status: 403 }))) as unknown as typeof fetch;
    await expect(innertube('search', {}, { ...deps, fetch: httpFail })).rejects.toMatchObject({
      kind: 'http',
      status: 403,
    });
    const netFail = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    await expect(innertube('search', {}, { ...deps, fetch: netFail })).rejects.toBeInstanceOf(InnertubeError);
    const badJson = (() => Promise.resolve(new Response('{', { status: 200 }))) as unknown as typeof fetch;
    await expect(innertube('search', {}, { ...deps, fetch: badJson })).rejects.toMatchObject({
      kind: 'parse',
    });
  });
});
