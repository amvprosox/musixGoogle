export const BAR_SELECTORS = [
  'ytmusic-player-bar[slot="player-bar"]',
  'ytmusic-app-layout > ytmusic-player-bar',
  'ytmusic-app ytmusic-player-bar:not(#top-player-bar)',
] as const;

export const SEL = {
  title: ['.content-info-wrapper .title', '.title.ytmusic-player-bar', '.title'],
  byline: ['.content-info-wrapper .byline', '.byline.ytmusic-player-bar', '.byline'],
  art: ['img.image', '.thumbnail-image-wrapper img', '.thumbnail img', 'img'],
  likeRenderer: ['ytmusic-like-button-renderer#like-button-renderer', 'ytmusic-like-button-renderer'],
  likeButton: ['#button-shape-like button', 'button[aria-label="Like"]', '.like'],
  dislikeButton: ['#button-shape-dislike button', 'button[aria-label="Dislike"]', '.dislike'],
  playPause: ['#play-pause-button', '.play-pause-button'],
  next: ['.next-button'],
  previous: ['.previous-button'],
  shuffle: ['.shuffle'],
  repeat: ['.repeat'],
  muteButton: ['.volume'],
  volumeSlider: ['#volume-slider', '.volume-slider'],
  timeInfo: ['.time-info'],
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

export function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
