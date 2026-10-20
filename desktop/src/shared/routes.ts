import { YTM_ORIGIN } from './constants';
import type { NavRoute, ShellRoute } from './types';

export const NAV_ROUTES: readonly NavRoute[] = ['home', 'explore', 'library', 'liked', 'playlists'];

export const NAV_PATHS: Readonly<Record<NavRoute, string>> = {
  home: '/',
  explore: '/explore',
  library: '/library',
  liked: '/playlist?list=LM',
  playlists: '/library/playlists',
};

export const NAV_BROWSE_IDS: Readonly<Record<NavRoute, string>> = {
  home: 'FEmusic_home',
  explore: 'FEmusic_explore',
  library: 'FEmusic_library_landing',
  liked: 'VLLM',
  playlists: 'FEmusic_liked_playlists',
};

export const MAX_QUERY_LENGTH = 500;

export function isNavRoute(value: unknown): value is NavRoute {
  return typeof value === 'string' && (NAV_ROUTES as readonly string[]).includes(value);
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function normalizeBase(base: string): string {
  const parsed = parseUrl(base);
  if (!parsed) {
    return YTM_ORIGIN;
  }
  return parsed.origin;
}

export function ytmRouteUrl(route: NavRoute, base: string = YTM_ORIGIN): string {
  return `${normalizeBase(base)}${NAV_PATHS[route]}`;
}

export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

export function ytmSearchUrl(query: string, base: string = YTM_ORIGIN): string {
  return `${normalizeBase(base)}/search?q=${encodeURIComponent(normalizeQuery(query))}`;
}

export function isSameOrigin(url: string, base: string = YTM_ORIGIN): boolean {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }
  return parsed.origin === normalizeBase(base);
}

export function routeFromUrl(url: string, base: string = YTM_ORIGIN): ShellRoute {
  const parsed = parseUrl(url);
  if (!parsed || parsed.origin !== normalizeBase(base)) {
    return 'other';
  }
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') {
    return 'home';
  }
  if (path === '/explore') {
    return 'explore';
  }
  if (path === '/library/playlists') {
    return 'playlists';
  }
  if (path === '/library' || path.startsWith('/library/')) {
    return 'library';
  }
  if (path === '/playlist' && parsed.searchParams.get('list') === 'LM') {
    return 'liked';
  }
  if (path === '/browse/VLLM') {
    return 'liked';
  }
  if (path === '/search') {
    return 'search';
  }
  return 'other';
}

export function searchQueryFromUrl(url: string): string {
  const parsed = parseUrl(url);
  if (!parsed || parsed.pathname !== '/search') {
    return '';
  }
  return parsed.searchParams.get('q') ?? '';
}

const SIGN_IN_HOSTS = [/^accounts\.google\.[a-z.]+$/, /^accounts\.youtube\.com$/];

export function isGoogleSignInUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || parsed.protocol !== 'https:') {
    return false;
  }
  if (SIGN_IN_HOSTS.some((pattern) => pattern.test(parsed.hostname))) {
    return true;
  }
  if (parsed.hostname === 'www.youtube.com' || parsed.hostname === 'youtube.com') {
    return parsed.pathname.startsWith('/signin') || parsed.pathname.startsWith('/logout');
  }
  return false;
}

export function isConsentUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || parsed.protocol !== 'https:') {
    return false;
  }
  return parsed.hostname === 'consent.youtube.com' || /^consent\.google\.[a-z.]+$/.test(parsed.hostname);
}

export function isInViewAllowedUrl(url: string, base: string = YTM_ORIGIN): boolean {
  return isSameOrigin(url, base) || isGoogleSignInUrl(url) || isConsentUrl(url);
}

export function isExternalOpenable(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:';
}

const IMAGE_HOSTS = [/(^|\.)googleusercontent\.com$/, /(^|\.)ggpht\.com$/, /(^|\.)ytimg\.com$/];

export function isAllowedImageUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || parsed.protocol !== 'https:') {
    return false;
  }
  return IMAGE_HOSTS.some((pattern) => pattern.test(parsed.hostname));
}
