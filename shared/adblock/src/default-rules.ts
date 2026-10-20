import type { ScriptletCall } from './filters';

export const DEFAULT_SCRIPTLETS: readonly ScriptletCall[] = [
  {
    name: 'json-prune',
    args: [
      'playerResponse.adPlacements playerResponse.playerAds playerResponse.adSlots adPlacements playerAds adSlots',
      '',
    ],
  },
  {
    name: 'json-prune-fetch-response',
    args: [
      'playerAds adPlacements adSlots playerResponse.playerAds playerResponse.adPlacements playerResponse.adSlots',
      '',
    ],
  },
  {
    name: 'set-constant',
    args: ['ytInitialPlayerResponse.playerAds', 'undefined'],
  },
  {
    name: 'set-constant',
    args: ['ytInitialPlayerResponse.adPlacements', 'undefined'],
  },
  {
    name: 'set-constant',
    args: ['ytInitialPlayerResponse.adSlots', 'undefined'],
  },
];

export const DEFAULT_COSMETIC: readonly string[] = [
  'ytmusic-mealbar-promo-renderer',
  'ytmusic-statement-banner-renderer',
  'ytmusic-upsell-dialog-renderer',
  'ytmusic-premium-upsell-renderer',
  'ytmusic-premium-promo-renderer',
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-display-ad-renderer',
  '.ytp-ad-overlay-container',
  '.ytp-ad-overlay-slot',
  '.ytp-ad-image-overlay',
  '.ytp-featured-product',
  '.ytp-paid-content-overlay',
  'tp-yt-paper-dialog:has(ytmusic-mealbar-promo-renderer)',
  'tp-yt-paper-dialog:has(ytmusic-upsell-dialog-renderer)',
  'ytmusic-carousel-shelf-renderer:has(ytd-ad-slot-renderer)',
  'ytmusic-guide-signin-promo-renderer',
  'ytmusic-app-download-promo-renderer',
  '#promotion-shelf',
];
