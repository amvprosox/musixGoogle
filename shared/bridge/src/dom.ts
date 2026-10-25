import type { LikeStatus, RepeatMode } from './contract';

export const BAR_SELECTORS = [
  'ytmusic-player-bar[slot="player-bar"]',
  'ytmusic-miniplayer[slot="player-bar"]',
  'ytmusic-app-layout > ytmusic-player-bar',
  'ytmusic-app-layout > ytmusic-miniplayer',
  'ytmusic-app ytmusic-player-bar:not(#top-player-bar)',
] as const;

export const SEL = {
  title: ['.content-info-wrapper .title', '.title.ytmusic-player-bar', '.ytmusicTrackInfoTitle', '.title'],
  byline: [
    '.content-info-wrapper .byline',
    '.byline.ytmusic-player-bar',
    '.ytmusicTrackInfoByline',
    '.byline',
  ],
  art: [
    'img.image',
    'img.ytmusicTrackInfoThumbnail',
    '.thumbnail-image-wrapper img',
    '.thumbnail img',
    'img',
  ],
  likeRenderer: ['ytmusic-like-button-renderer#like-button-renderer', 'ytmusic-like-button-renderer'],
  likeButton: [
    '#button-shape-like button',
    'like-button-view-model button',
    'button[aria-label="Like"]',
    '.like',
  ],
  dislikeButton: [
    '#button-shape-dislike button',
    'dislike-button-view-model button',
    'button[aria-label="Dislike"]',
    '.dislike',
  ],
  playPause: ['#play-pause-button', '.play-pause-button', '[client-ve-type="54213"] button'],
  next: ['.next-button', '[client-ve-type="36841"] button'],
  previous: ['.previous-button', '[client-ve-type="36840"] button'],
  shuffle: ['.shuffle', '[client-ve-type="45468"] button'],
  repeat: ['.repeat', '[client-ve-type="51548"] button'],
  muteButton: ['.volume', '.ytMusicMiniPlayerMuteButton button'],
  volumeSlider: ['#volume-slider', '.volume-slider', '.ytMusicMiniPlayerVolumePopup input[type="range"]'],
  timeInfo: ['.time-info', '.ytMusicMiniPlayerTimeInfo'],
} as const;

export const DOC_SEL = {
  app: ['ytmusic-app'],
  moviePlayer: ['#movie_player', '.html5-video-player'],
  video: ['#movie_player video.html5-main-video', 'video.html5-main-video', 'ytmusic-player video', 'video'],
  titleLink: ['#movie_player .ytp-title-link', '.ytp-title-link'],
  queueRoot: ['ytmusic-player-queue#queue', 'ytmusic-player-queue', '#side-panel ytmusic-player-queue'],
  queueItem: 'ytmusic-player-queue-item',
  queuePlayButton: ['ytmusic-play-button-renderer', '#play-button', '.song-info', 'yt-img-shadow'],
  queueTitle: ['.song-title', '.title'],
  queueArtist: ['.byline', '.secondary-flex-columns'],
  queueDuration: ['.duration'],
  queueThumb: ['.thumbnail img', 'yt-img-shadow img', 'img'],
  skipButtons: [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-slot button',
    'button[id^="skip-button"]',
    '[id^="skip-button"] button',
  ],
  adIndicators: [
    '.ytp-ad-player-overlay',
    '.ytp-ad-player-overlay-layout',
    '.ytp-ad-preview-container',
    '.ytp-ad-simple-ad-badge',
    '.ytp-ad-duration-remaining',
  ],
  signInLink: ['ytmusic-nav-bar a.sign-in-link', 'a.sign-in-link'],
  settingsButton: ['ytmusic-nav-bar ytmusic-settings-button', 'ytmusic-settings-button'],
  avatar: ['ytmusic-settings-button img', 'ytmusic-settings-button yt-img-shadow img'],
  youThere: ['ytmusic-you-there-renderer'],
  youThereConfirm: [
    '.buttons yt-button-renderer button',
    '.buttons button',
    'yt-button-renderer button',
    'tp-yt-paper-button',
    'button',
  ],
} as const;

export function queryFirst(root: ParentNode | null, selectors: readonly string[]): Element | null {
  if (!root) {
    return null;
  }
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    if (found) {
      return found;
    }
  }
  return null;
}

export function textOfElement(root: ParentNode | null, selectors: readonly string[]): string {
  const el = queryFirst(root, selectors);
  if (!el) {
    return '';
  }
  return el.textContent.replace(/\s+/g, ' ').trim();
}

export function clickFirst(root: ParentNode | null, selectors: readonly string[]): boolean {
  const el = queryFirst(root, selectors);
  if (el instanceof HTMLElement) {
    el.click();
    return true;
  }
  return false;
}

function pressed(root: ParentNode, selectors: readonly string[]): boolean {
  const el = queryFirst(root, selectors);
  return el !== null && el.getAttribute('aria-pressed') === 'true';
}

export function readLikeStatus(bar: Element): LikeStatus {
  const renderer = queryFirst(bar, SEL.likeRenderer);
  if (renderer) {
    const attr = renderer.getAttribute('like-status');
    return attr === 'LIKE' || attr === 'DISLIKE' ? attr : 'INDIFFERENT';
  }
  if (pressed(bar, ['like-button-view-model button'])) {
    return 'LIKE';
  }
  if (pressed(bar, ['dislike-button-view-model button'])) {
    return 'DISLIKE';
  }
  return 'INDIFFERENT';
}

export function readShuffle(bar: Element): boolean {
  if (bar.hasAttribute('shuffle-on')) {
    return true;
  }
  return pressed(bar, ['[client-ve-type="45468"] button']);
}

export function readRepeat(bar: Element): RepeatMode {
  const attr = bar.getAttribute('repeat-mode');
  if (attr === 'ALL' || attr === 'ONE' || attr === 'NONE') {
    return attr;
  }
  const button = queryFirst(bar, ['[client-ve-type="51548"] button']);
  if (!button || button.getAttribute('aria-pressed') !== 'true') {
    return 'NONE';
  }
  const label = button.getAttribute('aria-label') ?? '';
  return /\bone\b|1/i.test(label) ? 'ONE' : 'ALL';
}

export function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
