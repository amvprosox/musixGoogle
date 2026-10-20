import { describe, expect, it } from 'vitest';
import {
  isAllowedImageUrl,
  isExternalOpenable,
  isGoogleSignInUrl,
  isInViewAllowedUrl,
  isNavRoute,
  NAV_BROWSE_IDS,
  normalizeQuery,
  routeFromUrl,
  searchQueryFromUrl,
  ytmRouteUrl,
  ytmSearchUrl,
} from '../../src/shared/routes';

describe('URL routing map', () => {
  it('builds the documented YouTube Music URLs', () => {
    expect(ytmRouteUrl('home')).toBe('https://music.youtube.com/');
    expect(ytmRouteUrl('explore')).toBe('https://music.youtube.com/explore');
    expect(ytmRouteUrl('library')).toBe('https://music.youtube.com/library');
    expect(ytmRouteUrl('liked')).toBe('https://music.youtube.com/playlist?list=LM');
    expect(ytmRouteUrl('playlists')).toBe('https://music.youtube.com/library/playlists');
    expect(ytmSearchUrl('daft punk & co')).toBe('https://music.youtube.com/search?q=daft%20punk%20%26%20co');
  });

  it('honours a custom base origin', () => {
    expect(ytmRouteUrl('explore', 'http://127.0.0.1:4000/anything')).toBe('http://127.0.0.1:4000/explore');
  });

  it('maps URLs back to routes', () => {
    expect(routeFromUrl('https://music.youtube.com/')).toBe('home');
    expect(routeFromUrl('https://music.youtube.com/explore')).toBe('explore');
    expect(routeFromUrl('https://music.youtube.com/library')).toBe('library');
    expect(routeFromUrl('https://music.youtube.com/library/albums')).toBe('library');
    expect(routeFromUrl('https://music.youtube.com/library/playlists')).toBe('playlists');
    expect(routeFromUrl('https://music.youtube.com/playlist?list=LM')).toBe('liked');
    expect(routeFromUrl('https://music.youtube.com/browse/VLLM')).toBe('liked');
    expect(routeFromUrl('https://music.youtube.com/playlist?list=PL123')).toBe('other');
    expect(routeFromUrl('https://music.youtube.com/search?q=abc')).toBe('search');
    expect(routeFromUrl('https://music.youtube.com/watch?v=abc')).toBe('other');
    expect(routeFromUrl('https://accounts.google.com/')).toBe('other');
    expect(routeFromUrl('not a url')).toBe('other');
  });

  it('extracts search queries', () => {
    expect(searchQueryFromUrl('https://music.youtube.com/search?q=daft+punk')).toBe('daft punk');
    expect(searchQueryFromUrl('https://music.youtube.com/explore')).toBe('');
  });

  it('provides browse ids for SPA navigation', () => {
    expect(NAV_BROWSE_IDS.home).toBe('FEmusic_home');
    expect(NAV_BROWSE_IDS.liked).toBe('VLLM');
    expect(isNavRoute('playlists')).toBe(true);
    expect(isNavRoute('settings')).toBe(false);
  });

  it('normalizes queries', () => {
    expect(normalizeQuery('  daft   punk  ')).toBe('daft punk');
    expect(normalizeQuery('x'.repeat(600)).length).toBe(500);
  });

  it('classifies navigation targets', () => {
    expect(isGoogleSignInUrl('https://accounts.google.com/ServiceLogin?service=youtube')).toBe(true);
    expect(isGoogleSignInUrl('https://accounts.google.co.uk/signin')).toBe(true);
    expect(isGoogleSignInUrl('https://www.youtube.com/signin?action_handle_signin=true')).toBe(true);
    expect(isGoogleSignInUrl('http://accounts.google.com/')).toBe(false);
    expect(isGoogleSignInUrl('https://evil.example/accounts.google.com')).toBe(false);
    expect(isInViewAllowedUrl('https://music.youtube.com/explore')).toBe(true);
    expect(isInViewAllowedUrl('https://consent.youtube.com/m?continue=x')).toBe(true);
    expect(isInViewAllowedUrl('https://www.youtube.com/watch?v=1')).toBe(false);
    expect(isInViewAllowedUrl('https://example.com/')).toBe(false);
    expect(isExternalOpenable('https://example.com')).toBe(true);
    expect(isExternalOpenable('file:///etc/passwd')).toBe(false);
    expect(isExternalOpenable('javascript:alert(1)')).toBe(false);
  });

  it('only accepts artwork from the hosts the shell CSP allows', () => {
    expect(isAllowedImageUrl('https://lh3.googleusercontent.com/abc=w60-h60')).toBe(true);
    expect(isAllowedImageUrl('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://yt3.ggpht.com/a')).toBe(true);
    expect(isAllowedImageUrl('http://lh3.googleusercontent.com/abc')).toBe(false);
    expect(isAllowedImageUrl('http://127.0.0.1:4000/')).toBe(false);
    expect(isAllowedImageUrl('https://evilgoogleusercontent.com/a')).toBe(false);
    expect(isAllowedImageUrl('data:image/png;base64,AAAA')).toBe(false);
  });
});
