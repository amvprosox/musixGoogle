import tokens from '@musix/design/tokens.json';

export const ASSET_FONT_BASE = 'musix-asset://fonts/';

const FONT_FACES: readonly { family: string; file: string; weight: number }[] = [
  { family: 'Manrope', file: 'manrope-latin-400-normal.woff2', weight: 400 },
  { family: 'Manrope', file: 'manrope-latin-500-normal.woff2', weight: 500 },
  { family: 'Manrope', file: 'manrope-latin-600-normal.woff2', weight: 600 },
  { family: 'Sora', file: 'sora-latin-600-normal.woff2', weight: 600 },
  { family: 'Sora', file: 'sora-latin-700-normal.woff2', weight: 700 },
];

const fontFaceCss = FONT_FACES.map(
  (face) =>
    `@font-face{font-family:'${face.family}';font-style:normal;font-display:swap;font-weight:${face.weight};src:url('${ASSET_FONT_BASE}${face.file}') format('woff2');}`,
).join('\n');

const dark = tokens.color.dark;
const size = tokens.size.scrollbar;
const fadeIn = tokens.motion.scrollbarFadeIn;

export const SCROLLER_SELECTORS = [
  'ytmusic-carousel #items',
  'ytmusic-chip-cloud-renderer #chips',
  '.ytmusicGridCarouselShelfContents',
];

export const YTM_INJECTED_CSS = `
${fontFaceCss}
@property --musix-sb {
  syntax: '<color>';
  inherits: false;
  initial-value: transparent;
}
ytmusic-player-bar[slot="player-bar"],
ytmusic-app-layout > ytmusic-player-bar,
#player-bar-background,
tp-yt-app-drawer#guide,
#guide-wrapper,
#guide-spacer,
#mini-guide,
#mini-guide-background,
#mini-guide-spacer,
ytmusic-guide-renderer,
#nav-bar-background,
#nav-bar-divider,
ytmusic-carousel-shelf-basic-header-renderer #previous-items-button,
ytmusic-carousel-shelf-basic-header-renderer #next-items-button {
  display: none !important;
}
ytmusic-nav-bar {
  opacity: 0 !important;
  pointer-events: none !important;
  transform: translateY(-200%) !important;
}
ytmusic-app-layout {
  --ytmusic-nav-bar-height: 0px !important;
  --ytmusic-player-bar-height: 0px !important;
  --ytmusic-guide-width: 0px !important;
  --ytmusic-mini-guide-width: 0px !important;
}
ytmusic-app-layout > #content {
  margin-left: 0 !important;
  padding-left: 0 !important;
}
html, body {
  overflow-x: clip !important;
  overscroll-behavior: none !important;
}
html {
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: auto !important;
  scrollbar-color: auto !important;
  overscroll-behavior: contain;
}
html, .scroller {
  transition: --musix-sb ${tokens.motion.scrollbarFadeOut / 2}ms ease;
}
*:hover, .musix-scrolling {
  --musix-sb: ${dark.scrollbarThumb};
}
html:hover, .scroller:hover, html.musix-scrolling, .scroller.musix-scrolling {
  transition: --musix-sb ${fadeIn}ms ease;
}
::-webkit-scrollbar {
  width: ${size}px;
  height: ${size}px;
  background: transparent;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background-color: var(--musix-sb);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover {
  background-color: ${dark.scrollbarThumbHover};
}
::-webkit-scrollbar-thumb:active {
  background-color: ${dark.accent};
}
::-webkit-scrollbar-corner {
  background: transparent;
}
::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}
${SCROLLER_SELECTORS.join(',\n')} {
  scrollbar-width: none !important;
}
${SCROLLER_SELECTORS.map((selector) => `${selector}::-webkit-scrollbar`).join(',\n')} {
  display: none;
  width: 0;
  height: 0;
}
ytmusic-carousel, ytmusic-chip-cloud-renderer {
  position: relative !important;
}
.musix-shelf-btn {
  position: absolute;
  top: 50%;
  z-index: 5;
  width: 40px;
  height: 40px;
  margin-top: -20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${dark.border};
  border-radius: 999px;
  background: ${dark.surface2};
  color: ${dark.text};
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity ${tokens.motion.hover}ms ease, background-color ${tokens.motion.hover}ms ease;
}
.musix-shelf-btn svg {
  width: 20px;
  height: 20px;
}
.musix-shelf-btn[data-dir="prev"] {
  left: 4px;
}
.musix-shelf-btn[data-dir="next"] {
  right: 4px;
}
ytmusic-carousel:hover > .musix-shelf-btn:not([disabled]),
ytmusic-chip-cloud-renderer:hover > .musix-shelf-btn:not([disabled]) {
  opacity: 1;
  pointer-events: auto;
}
.musix-shelf-btn:hover {
  background: ${dark.surfaceHover};
}
.musix-shelf-btn[disabled] {
  opacity: 0 !important;
  pointer-events: none !important;
}
body, ytmusic-app, ytmusic-app-layout, yt-formatted-string, .yt-formatted-string, button, input, tp-yt-paper-item, .ytmusic-chip-cloud-chip-renderer {
  font-family: 'Manrope', Roboto, 'Noto Sans', Arial, sans-serif !important;
}
h1, h2, h3, h4, h5, h6,
ytmusic-carousel-shelf-basic-header-renderer .title,
ytmusic-carousel-shelf-basic-header-renderer .title yt-formatted-string,
ytmusic-responsive-header-renderer .title,
ytmusic-immersive-header-renderer .title,
ytmusic-detail-header-renderer .title,
ytmusic-visual-header-renderer .title,
ytmusic-shelf-renderer .title.ytmusic-shelf-renderer,
ytmusic-tab-renderer .title.ytmusic-header-renderer {
  font-family: 'Sora', 'Manrope', Roboto, Arial, sans-serif !important;
}
ytmusic-app, ytmusic-app * {
  -webkit-user-select: none;
  user-select: none;
  cursor: default;
}
input, textarea, [contenteditable="true"],
ytmusic-description-shelf-renderer, ytmusic-description-shelf-renderer *,
.ytmusic-description-shelf-renderer, .lyrics, .lyrics * {
  -webkit-user-select: text !important;
  user-select: text !important;
}
input, textarea, [contenteditable="true"] {
  cursor: text;
}
a[href], button, [role="button"], tp-yt-paper-icon-button, yt-button-shape, ytmusic-play-button-renderer, tp-yt-paper-tab, .musix-shelf-btn {
  cursor: pointer;
}
img, a, svg {
  -webkit-user-drag: none !important;
}
::selection {
  background: ${dark.accentSoft};
  color: ${dark.text};
}
:focus:not(:focus-visible) {
  outline: none !important;
}
ytmusic-mealbar-promo-renderer,
ytmusic-statement-banner-renderer,
ytmusic-upsell-dialog-renderer,
ytmusic-premium-upsell-renderer,
ytmusic-premium-promo-renderer,
ytmusic-app-download-promo-renderer,
ytmusic-guide-signin-promo-renderer,
ytmusic-consent-bump-renderer,
ytd-consent-bump-v2-lightbox,
tp-yt-paper-dialog:has(ytmusic-consent-bump-renderer),
ytd-ad-slot-renderer,
ytd-in-feed-ad-layout-renderer,
ytd-promoted-sparkles-web-renderer,
ytd-display-ad-renderer,
ytmusic-carousel-shelf-renderer:has(ytd-ad-slot-renderer),
[is-promoted],
.ytp-ad-overlay-container,
.ytp-ad-overlay-slot,
.ytp-ad-image-overlay,
.ytp-featured-product,
.ytp-paid-content-overlay,
tp-yt-paper-dialog:has(ytmusic-mealbar-promo-renderer),
tp-yt-paper-dialog:has(ytmusic-upsell-dialog-renderer),
a[href*="play.google.com/store"],
a[href*="apps.apple.com"],
ytmusic-menu-navigation-item-renderer:has(a[href*="support.google.com"]),
ytmusic-menu-navigation-item-renderer:has(a[href*="/premium"]) {
  display: none !important;
}
`;
