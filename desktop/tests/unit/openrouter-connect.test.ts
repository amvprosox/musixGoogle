import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authUrl, connectOpenRouter, createPkce, exchangeCode } from '../../src/main/openrouter-connect';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenRouter connect', () => {
  it('builds a PKCE S256 challenge and auth URL', () => {
    const pkce = createPkce();
    const expected = createHash('sha256').update(pkce.verifier).digest('base64url');
    expect(pkce.challenge).toBe(expected);
    const url = new URL(authUrl(pkce, 'http://localhost:4567/callback', 'Musix desktop'));
    expect(url.origin).toBe('https://openrouter.ai');
    expect(url.searchParams.get('callback_url')).toBe('http://localhost:4567/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(pkce.state);
  });

  it('exchanges the code for a key', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ key: 'sk-or-test' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(exchangeCode('abc', 'verifier')).resolves.toBe('sk-or-test');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      code: 'abc',
      code_verifier: 'verifier',
      code_challenge_method: 'S256',
    });
  });

  it('receives the browser callback on localhost and rejects a wrong state', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) =>
        String(input).startsWith('https://openrouter.ai')
          ? Promise.resolve(new Response(JSON.stringify({ key: 'sk-or-live' }), { status: 200 }))
          : realFetch(input, init),
      ),
    );
    let opened = '';
    const pending = connectOpenRouter({
      label: 'Musix desktop',
      openExternal: (url) => {
        opened = url;
        return Promise.resolve();
      },
    });
    await vi.waitFor(() => {
      expect(opened).not.toBe('');
    });
    const auth = new URL(opened);
    const callback = new URL(auth.searchParams.get('callback_url') ?? '');
    const state = auth.searchParams.get('state') ?? '';
    const bad = await realFetch(`http://127.0.0.1:${callback.port}/other`);
    expect(bad.status).toBe(404);
    const ok = await realFetch(`http://127.0.0.1:${callback.port}/callback?code=xyz&state=${state}`);
    expect(ok.status).toBe(200);
    await expect(pending).resolves.toBe('sk-or-live');
  });
});
