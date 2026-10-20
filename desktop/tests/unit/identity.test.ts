import { describe, expect, it } from 'vitest';
import { accountRequestHeaders, isGoogleAccountsUrl, nativeUserAgent } from '../../src/shared/identity';

describe('sign-in identity', () => {
  it('matches only Google account hosts over https', () => {
    expect(isGoogleAccountsUrl('https://accounts.google.com/v3/signin/identifier')).toBe(true);
    expect(isGoogleAccountsUrl('https://accounts.google.co.uk/ServiceLogin')).toBe(true);
    expect(isGoogleAccountsUrl('https://accounts.youtube.com/accounts/SetSID')).toBe(true);
    expect(isGoogleAccountsUrl('http://accounts.google.com/')).toBe(false);
    expect(isGoogleAccountsUrl('https://music.youtube.com/')).toBe(false);
    expect(isGoogleAccountsUrl('https://accounts.google.com.evil.example/')).toBe(false);
    expect(isGoogleAccountsUrl('not a url')).toBe(false);
  });

  it('uses the native browser identity and keeps client hints consistent', () => {
    const native = nativeUserAgent(' Mozilla/5.0 Chrome/140.0.0.0 Electron/44.9.0 Safari/537.36 ');
    const headers = accountRequestHeaders(
      { 'User-Agent': 'Spoofed', 'sec-ch-ua': '"Chromium";v="140"', Accept: 'text/html' },
      native,
    );
    expect(headers).toEqual({
      'sec-ch-ua': '"Chromium";v="140"',
      Accept: 'text/html',
      'User-Agent': 'Mozilla/5.0 Chrome/140.0.0.0 Electron/44.9.0 Safari/537.36',
    });
  });
});
