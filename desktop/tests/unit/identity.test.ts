import { describe, expect, it } from 'vitest';
import {
  accountRequestHeaders,
  firefoxUserAgent,
  firefoxVersionFor,
  isGoogleAccountsUrl,
} from '../../src/shared/identity';

describe('sign-in identity', () => {
  it('tracks the current Firefox release train', () => {
    expect(firefoxVersionFor(new Date(Date.UTC(2024, 0, 1)))).toBe(128);
    expect(firefoxVersionFor(new Date(Date.UTC(2025, 5, 24)))).toBeGreaterThanOrEqual(139);
    expect(firefoxVersionFor(new Date(Date.UTC(2026, 9, 20)))).toBeGreaterThan(150);
    expect(firefoxUserAgent(new Date(Date.UTC(2026, 9, 20)))).toMatch(
      /^Mozilla\/5\.0 \(X11; Linux x86_64; rv:\d+\.0\) Gecko\/20100101 Firefox\/\d+\.0$/,
    );
  });

  it('matches only Google account hosts over https', () => {
    expect(isGoogleAccountsUrl('https://accounts.google.com/v3/signin/identifier')).toBe(true);
    expect(isGoogleAccountsUrl('https://accounts.google.co.uk/ServiceLogin')).toBe(true);
    expect(isGoogleAccountsUrl('https://accounts.youtube.com/accounts/SetSID')).toBe(true);
    expect(isGoogleAccountsUrl('http://accounts.google.com/')).toBe(false);
    expect(isGoogleAccountsUrl('https://music.youtube.com/')).toBe(false);
    expect(isGoogleAccountsUrl('https://accounts.google.com.evil.example/')).toBe(false);
    expect(isGoogleAccountsUrl('not a url')).toBe(false);
  });

  it('replaces the user agent and drops client hints', () => {
    const headers = accountRequestHeaders(
      {
        'User-Agent': 'Chrome',
        'sec-ch-ua': '"Chromium";v="140"',
        'Sec-CH-UA-Platform': '"Linux"',
        'sec-ch-ua-mobile': '?0',
        Accept: 'text/html',
      },
      'Firefox',
    );
    expect(headers).toEqual({ Accept: 'text/html', 'User-Agent': 'Firefox' });
  });
});
