import type { BrowsePage, FlatItem, FlatSection, ItemType } from './contract';

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function at(value: unknown, ...path: (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof key === 'number') {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[key];
    } else {
      const record = rec(current);
      if (!record) {
        return undefined;
      }
      current = record[key];
    }
  }
  return current;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function textOf(value: unknown): string {
  const record = rec(value);
  if (!record) {
    return '';
  }
  if (typeof record.simpleText === 'string') {
    return record.simpleText.trim();
  }
  return arr(record.runs)
    .map((run) => str(rec(run)?.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseClock(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}(:\d{2}){1,2}$/.test(trimmed)) {
    return null;
  }
  return trimmed.split(':').reduce((total, part) => total * 60 + Number.parseInt(part, 10), 0);
}

export function upgradeArtwork(url: string, size = 544): string {
  if (!url.startsWith('https://')) {
    return '';
  }
  if (/(googleusercontent|ggpht)\.com/.test(url)) {
    if (/=w\d+-h\d+/.test(url)) {
      return url.replace(/=w\d+-h\d+(-[a-z0-9-]*)?$/i, `=w${size}-h${size}-l90-rj`);
    }
    if (/=s\d+/.test(url)) {
      return url.replace(/=s\d+(-[a-z0-9-]*)?$/i, `=s${size}`);
    }
  }
  return url;
}

export function bestThumbnail(value: unknown, size = 544): string {
  const containers = [
    at(value, 'musicThumbnailRenderer', 'thumbnail', 'thumbnails'),
    at(value, 'thumbnail', 'thumbnails'),
    at(value, 'thumbnails'),
    at(value, 'croppedSquareThumbnailRenderer', 'thumbnail', 'thumbnails'),
  ];
  for (const list of containers) {
    const candidates = arr(list)
      .map((entry) => rec(entry))
      .filter((entry): entry is Rec => entry !== null && typeof entry.url === 'string');
    if (candidates.length === 0) {
      continue;
    }
    const best = candidates.reduce((a, b) => (Number(b.width ?? 0) > Number(a.width ?? 0) ? b : a));
    let url = str(best.url);
    if (url.startsWith('//')) {
      url = `https:${url}`;
    }
    return upgradeArtwork(url, size);
  }
  return '';
}

type Endpoint =
  | { kind: 'watch'; videoId: string; playlistId: string | null; videoType: string }
  | { kind: 'watchPlaylist'; playlistId: string }
  | { kind: 'browse'; browseId: string; params: string | null; pageType: string };

export function endpointOf(value: unknown): Endpoint | null {
  const endpoint = rec(value);
  if (!endpoint) {
    return null;
  }
  const watch = rec(endpoint.watchEndpoint);
  if (watch && typeof watch.videoId === 'string') {
    return {
      kind: 'watch',
      videoId: watch.videoId,
      playlistId: typeof watch.playlistId === 'string' ? watch.playlistId : null,
      videoType: str(
        at(watch, 'watchEndpointMusicSupportedConfigs', 'watchEndpointMusicConfig', 'musicVideoType'),
      ),
    };
  }
  const watchPlaylist = rec(endpoint.watchPlaylistEndpoint);
  if (watchPlaylist && typeof watchPlaylist.playlistId === 'string') {
    return { kind: 'watchPlaylist', playlistId: watchPlaylist.playlistId };
  }
  if (watch && typeof watch.playlistId === 'string') {
    return { kind: 'watchPlaylist', playlistId: watch.playlistId };
  }
  const browse = rec(endpoint.browseEndpoint);
  if (browse && typeof browse.browseId === 'string') {
    return {
      kind: 'browse',
      browseId: browse.browseId,
      params: typeof browse.params === 'string' ? browse.params : null,
      pageType: str(
        at(browse, 'browseEndpointContextSupportedConfigs', 'browseEndpointContextMusicConfig', 'pageType'),
      ),
    };
  }
  return null;
}

export function typeForPage(pageType: string, browseId: string): ItemType {
  if (pageType.includes('ALBUM') || browseId.startsWith('MPRE')) {
    return 'album';
  }
  if (pageType.includes('ARTIST') || pageType.includes('USER_CHANNEL') || browseId.startsWith('UC')) {
    return 'artist';
  }
  if (
    pageType.includes('PLAYLIST') ||
    pageType.includes('PODCAST') ||
    browseId.startsWith('VL') ||
    browseId.startsWith('MPSP')
  ) {
    return 'playlist';
  }
  return 'shelf';
}

function typeForVideo(videoType: string): ItemType {
  if (
    videoType === 'MUSIC_VIDEO_TYPE_OMV' ||
    videoType === 'MUSIC_VIDEO_TYPE_UGC' ||
    videoType === 'MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC'
  ) {
    return 'video';
  }
  return 'song';
}

export function nodeIdFor(browseId: string, params: string | null): string {
  return params ? `${browseId}|${params}` : browseId;
}

function playEndpoint(renderer: Rec): Endpoint | null {
  const overlays = [
    at(
      renderer,
      'thumbnailOverlay',
      'musicItemThumbnailOverlayRenderer',
      'content',
      'musicPlayButtonRenderer',
      'playNavigationEndpoint',
    ),
    at(
      renderer,
      'overlay',
      'musicItemThumbnailOverlayRenderer',
      'content',
      'musicPlayButtonRenderer',
      'playNavigationEndpoint',
    ),
  ];
  for (const overlay of overlays) {
    const endpoint = endpointOf(overlay);
    if (endpoint) {
      return endpoint;
    }
  }
  return null;
}

function buildItem(input: {
  id: string;
  title: string;
  subtitle: string;
  artworkUrl: string;
  navigation: Endpoint | null;
  play: Endpoint | null;
  durationSec: number | null;
}): FlatItem | null {
  const { navigation, play } = input;
  if (input.title === '') {
    return null;
  }
  const base = {
    id: input.id,
    title: input.title,
    subtitle: input.subtitle,
    artworkUrl: input.artworkUrl,
    durationSec: input.durationSec,
    continuation: null,
  };
  if (navigation && navigation.kind === 'browse') {
    const type = typeForPage(navigation.pageType, navigation.browseId);
    const playlistId =
      play && play.kind === 'watchPlaylist'
        ? play.playlistId
        : play && play.kind === 'watch'
          ? play.playlistId
          : type === 'playlist' && navigation.browseId.startsWith('VL')
            ? navigation.browseId.slice(2)
            : null;
    const videoId = play && play.kind === 'watch' ? play.videoId : null;
    return {
      ...base,
      id: nodeIdFor(navigation.browseId, navigation.params),
      type,
      browsable: true,
      playable: playlistId !== null || videoId !== null,
      videoId,
      playlistId,
      browseId: nodeIdFor(navigation.browseId, navigation.params),
    };
  }
  const watch =
    navigation && navigation.kind === 'watch' ? navigation : play && play.kind === 'watch' ? play : null;
  if (watch) {
    return {
      ...base,
      id: watch.videoId,
      type: typeForVideo(watch.videoType),
      browsable: false,
      playable: true,
      videoId: watch.videoId,
      playlistId: watch.playlistId,
      browseId: null,
    };
  }
  const list =
    navigation && navigation.kind === 'watchPlaylist'
      ? navigation
      : play && play.kind === 'watchPlaylist'
        ? play
        : null;
  if (list) {
    return {
      ...base,
      id: `playlist:${list.playlistId}`,
      type: 'playlist',
      browsable: false,
      playable: true,
      videoId: null,
      playlistId: list.playlistId,
      browseId: null,
    };
  }
  return null;
}

function parseTwoRow(renderer: Rec): FlatItem | null {
  return buildItem({
    id: '',
    title: textOf(renderer.title),
    subtitle: textOf(renderer.subtitle),
    artworkUrl: bestThumbnail(renderer.thumbnailRenderer),
    navigation:
      endpointOf(renderer.navigationEndpoint) ??
      endpointOf(at(renderer, 'title', 'runs', 0, 'navigationEndpoint')),
    play: playEndpoint(renderer),
    durationSec: null,
  });
}

function parseResponsive(renderer: Rec): FlatItem | null {
  const columns = arr(renderer.flexColumns).map((column) =>
    at(column, 'musicResponsiveListItemFlexColumnRenderer', 'text'),
  );
  const title = textOf(columns[0]);
  const subtitleParts = columns
    .slice(1)
    .map((column) => textOf(column))
    .filter((part) => part !== '');
  const fixed = arr(renderer.fixedColumns).map((column) =>
    textOf(at(column, 'musicResponsiveListItemFixedColumnRenderer', 'text')),
  );
  let durationSec: number | null = null;
  for (const candidate of [...fixed, ...subtitleParts.flatMap((part) => part.split(' • '))]) {
    const parsed = parseClock(candidate);
    if (parsed !== null) {
      durationSec = parsed;
      break;
    }
  }
  const titleEndpoint = endpointOf(at(columns[0], 'runs', 0, 'navigationEndpoint'));
  const playlistVideoId = str(at(renderer, 'playlistItemData', 'videoId'));
  let navigation = endpointOf(renderer.navigationEndpoint) ?? titleEndpoint;
  const play = playEndpoint(renderer);
  if (!navigation && playlistVideoId !== '') {
    navigation = {
      kind: 'watch',
      videoId: playlistVideoId,
      playlistId: play && play.kind === 'watch' ? play.playlistId : null,
      videoType: play && play.kind === 'watch' ? play.videoType : '',
    };
  }
  return buildItem({
    id: '',
    title,
    subtitle: subtitleParts.join(' • '),
    artworkUrl: bestThumbnail(renderer.thumbnail),
    navigation,
    play,
    durationSec,
  });
}

function parsePanelVideo(renderer: Rec): FlatItem | null {
  const videoId = str(renderer.videoId);
  const navigation = endpointOf(renderer.navigationEndpoint);
  return buildItem({
    id: videoId,
    title: textOf(renderer.title),
    subtitle: textOf(renderer.longBylineText) || textOf(renderer.shortBylineText),
    artworkUrl: bestThumbnail(renderer.thumbnail),
    navigation:
      navigation ?? (videoId !== '' ? { kind: 'watch', videoId, playlistId: null, videoType: '' } : null),
    play: null,
    durationSec: parseClock(textOf(renderer.lengthText)),
  });
}

function parseNavigationButton(renderer: Rec): FlatItem | null {
  const endpoint = endpointOf(renderer.clickCommand);
  if (!endpoint || endpoint.kind !== 'browse') {
    return null;
  }
  const title = textOf(renderer.buttonText);
  if (title === '') {
    return null;
  }
  const id = nodeIdFor(endpoint.browseId, endpoint.params);
  return {
    id,
    title,
    subtitle: '',
    artworkUrl: '',
    type: 'shelf',
    playable: false,
    browsable: true,
    videoId: null,
    playlistId: null,
    browseId: id,
    durationSec: null,
    continuation: null,
  };
}

function parseMultiRow(renderer: Rec): FlatItem | null {
  return buildItem({
    id: '',
    title: textOf(renderer.title),
    subtitle: textOf(renderer.subtitle),
    artworkUrl: bestThumbnail(renderer.thumbnail),
    navigation:
      endpointOf(renderer.onTap) ?? endpointOf(at(renderer, 'title', 'runs', 0, 'navigationEndpoint')),
    play: playEndpoint(renderer),
    durationSec: null,
  });
}

export function parseItemRenderer(wrapper: unknown): FlatItem | null {
  const record = rec(wrapper);
  if (!record) {
    return null;
  }
  try {
    const twoRow = rec(record.musicTwoRowItemRenderer);
    if (twoRow) {
      return parseTwoRow(twoRow);
    }
    const responsive = rec(record.musicResponsiveListItemRenderer);
    if (responsive) {
      return parseResponsive(responsive);
    }
    const panel =
      rec(record.playlistPanelVideoRenderer) ??
      rec(at(record, 'playlistPanelVideoWrapperRenderer', 'primaryRenderer', 'playlistPanelVideoRenderer'));
    if (panel) {
      return parsePanelVideo(panel);
    }
    const button = rec(record.musicNavigationButtonRenderer);
    if (button) {
      return parseNavigationButton(button);
    }
    const multi = rec(record.musicMultiRowListItemRenderer);
    if (multi) {
      return parseMultiRow(multi);
    }
  } catch {
    return null;
  }
  return null;
}

export function continuationOf(value: unknown): string | null {
  for (const entry of arr(rec(value)?.continuations)) {
    const token =
      at(entry, 'nextContinuationData', 'continuation') ??
      at(entry, 'nextRadioContinuationData', 'continuation');
    if (typeof token === 'string' && token !== '') {
      return token;
    }
  }
  return null;
}

function trailingContinuation(contents: unknown[]): string | null {
  for (const entry of contents) {
    const token =
      at(entry, 'continuationItemRenderer', 'continuationEndpoint', 'continuationCommand', 'token') ??
      at(
        entry,
        'continuationItemRenderer',
        'button',
        'buttonRenderer',
        'command',
        'continuationCommand',
        'token',
      );
    if (typeof token === 'string' && token !== '') {
      return token;
    }
  }
  return null;
}

function itemsFrom(contents: unknown[]): FlatItem[] {
  const items: FlatItem[] = [];
  const seen = new Set<string>();
  for (const entry of contents) {
    const item = parseItemRenderer(entry);
    if (!item) {
      continue;
    }
    let id = item.id;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${item.id}#${suffix}`;
      suffix += 1;
    }
    seen.add(id);
    items.push(id === item.id ? item : { ...item, id });
  }
  return items;
}

const SHELF_KEYS = [
  'musicCarouselShelfRenderer',
  'musicImmersiveCarouselShelfRenderer',
  'musicShelfRenderer',
  'musicPlaylistShelfRenderer',
  'gridRenderer',
  'musicCardShelfRenderer',
  'sectionListContinuation',
  'musicShelfContinuation',
  'musicPlaylistShelfContinuation',
  'gridContinuation',
  'itemSectionRenderer',
] as const;

interface ShelfResult {
  title: string;
  browseId: string | null;
  items: FlatItem[];
  continuation: string | null;
  isTrackList: boolean;
}

function shelfTitle(shelf: Rec): string {
  return (
    textOf(at(shelf, 'header', 'musicCarouselShelfBasicHeaderRenderer', 'title')) ||
    textOf(at(shelf, 'header', 'musicImmersiveCarouselShelfBasicHeaderRenderer', 'title')) ||
    textOf(at(shelf, 'header', 'gridHeaderRenderer', 'title')) ||
    textOf(shelf.title)
  );
}

function shelfMore(shelf: Rec): string | null {
  const candidates = [
    at(
      shelf,
      'header',
      'musicCarouselShelfBasicHeaderRenderer',
      'moreContentButton',
      'buttonRenderer',
      'navigationEndpoint',
    ),
    at(shelf, 'header', 'musicCarouselShelfBasicHeaderRenderer', 'title', 'runs', 0, 'navigationEndpoint'),
    at(shelf, 'bottomEndpoint'),
    at(shelf, 'title', 'runs', 0, 'navigationEndpoint'),
  ];
  for (const candidate of candidates) {
    const endpoint = endpointOf(candidate);
    if (endpoint && endpoint.kind === 'browse') {
      return nodeIdFor(endpoint.browseId, endpoint.params);
    }
  }
  return null;
}

function parseCard(card: Rec): ShelfResult {
  const top = buildItem({
    id: '',
    title: textOf(card.title),
    subtitle: textOf(card.subtitle),
    artworkUrl: bestThumbnail(card.thumbnail),
    navigation: endpointOf(at(card, 'title', 'runs', 0, 'navigationEndpoint')) ?? endpointOf(card.onTap),
    play: endpointOf(
      at(
        card,
        'thumbnailOverlay',
        'musicItemThumbnailOverlayRenderer',
        'content',
        'musicPlayButtonRenderer',
        'playNavigationEndpoint',
      ),
    ),
    durationSec: null,
  });
  const items = itemsFrom(arr(card.contents));
  return {
    title: textOf(at(card, 'header', 'musicCardShelfHeaderBasicRenderer', 'title')) || 'Top result',
    browseId: null,
    items: top ? [top, ...items.filter((item) => item.id !== top.id)] : items,
    continuation: null,
    isTrackList: false,
  };
}

function parseShelf(key: string, shelf: Rec): ShelfResult {
  if (key === 'musicCardShelfRenderer') {
    return parseCard(shelf);
  }
  const contents = arr(shelf.contents ?? shelf.items);
  return {
    title: shelfTitle(shelf),
    browseId: shelfMore(shelf),
    items: itemsFrom(contents),
    continuation: continuationOf(shelf) ?? trailingContinuation(contents),
    isTrackList: key === 'musicPlaylistShelfRenderer' || key === 'musicPlaylistShelfContinuation',
  };
}

function collectShelves(value: unknown, out: { key: string; shelf: Rec }[], depth = 0): void {
  if (depth > 30) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectShelves(entry, out, depth + 1);
    }
    return;
  }
  const record = rec(value);
  if (!record) {
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    const childRecord = rec(child);
    if (childRecord && (SHELF_KEYS as readonly string[]).includes(key)) {
      if (key === 'sectionListContinuation') {
        collectShelves(childRecord.contents, out, depth + 1);
        continue;
      }
      out.push({ key, shelf: childRecord });
      continue;
    }
    if (
      key === 'header' ||
      key === 'frameworkUpdates' ||
      key === 'responseContext' ||
      key === 'microformat'
    ) {
      continue;
    }
    collectShelves(child, out, depth + 1);
  }
}

function sectionListContinuation(value: unknown, depth = 0): string | null {
  if (depth > 20) {
    return null;
  }
  const record = rec(value);
  if (record) {
    for (const key of ['sectionListRenderer', 'sectionListContinuation']) {
      const section = rec(record[key]);
      if (section) {
        const token = continuationOf(section) ?? trailingContinuation(arr(section.contents));
        if (token) {
          return token;
        }
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'responseContext' || key === 'frameworkUpdates') {
        continue;
      }
      const token = sectionListContinuation(child, depth + 1);
      if (token) {
        return token;
      }
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      const token = sectionListContinuation(entry, depth + 1);
      if (token) {
        return token;
      }
    }
  }
  return null;
}

function pageHeader(response: Rec): Rec | null {
  const headers = [
    response.header,
    at(
      response,
      'contents',
      'twoColumnBrowseResultsRenderer',
      'tabs',
      0,
      'tabRenderer',
      'content',
      'sectionListRenderer',
      'contents',
      0,
    ),
  ];
  for (const header of headers) {
    const record = rec(header);
    if (!record) {
      continue;
    }
    for (const value of Object.values(record)) {
      const inner = rec(value);
      if (inner && textOf(inner.title) !== '') {
        return inner;
      }
    }
  }
  return null;
}

function isAlbumNode(nodeId: string): boolean {
  return nodeId.startsWith('MPRE');
}

function appendedItems(response: Rec): { items: FlatItem[]; continuation: string | null } {
  const items: FlatItem[] = [];
  let continuation: string | null = null;
  for (const action of arr(response.onResponseReceivedActions)) {
    const continuationItems = arr(at(action, 'appendContinuationItemsAction', 'continuationItems'));
    items.push(...itemsFrom(continuationItems));
    continuation = continuation ?? trailingContinuation(continuationItems);
  }
  return { items, continuation };
}

export function parseBrowseResponse(response: unknown, nodeId: string): BrowsePage {
  const root = rec(response) ?? {};
  const shelves: { key: string; shelf: Rec }[] = [];
  collectShelves(root.contents, shelves);
  collectShelves(root.continuationContents, shelves);
  const sections: FlatSection[] = [];
  const items: FlatItem[] = [];
  let trackContinuation = null as string | null;
  shelves.forEach(({ key, shelf }, index) => {
    const parsed = parseShelf(key, shelf);
    if (parsed.isTrackList || (parsed.title === '' && parsed.items.length > 0)) {
      items.push(...parsed.items);
      trackContinuation = trackContinuation ?? parsed.continuation;
      return;
    }
    if (parsed.items.length === 0) {
      return;
    }
    sections.push({
      id: `${nodeId}#${index}`,
      title: parsed.title,
      browseId: parsed.browseId,
      items: parsed.items,
    });
    if (key === 'musicShelfRenderer' || key === 'musicShelfContinuation') {
      trackContinuation = trackContinuation ?? parsed.continuation;
    }
  });
  const appended = appendedItems(root);
  items.push(...appended.items);
  const header = pageHeader(root);
  const headerArtwork = header
    ? bestThumbnail(header.thumbnail) || bestThumbnail(header.foregroundThumbnail)
    : '';
  const album = isAlbumNode(nodeId);
  const finalItems = items.map((item) => {
    const artworkUrl = item.artworkUrl === '' ? headerArtwork : item.artworkUrl;
    const type = album && item.type === 'video' ? 'song' : item.type;
    return artworkUrl === item.artworkUrl && type === item.type ? item : { ...item, artworkUrl, type };
  });
  return {
    nodeId,
    title: header ? textOf(header.title) : '',
    sections,
    items: finalItems,
    continuation:
      trackContinuation ??
      appended.continuation ??
      sectionListContinuation(root.continuationContents ?? root.contents),
  };
}

export function parseQueueResponse(response: unknown): FlatItem[] {
  const root = rec(response) ?? {};
  const out: FlatItem[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 30) {
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry, depth + 1);
      }
      return;
    }
    const record = rec(value);
    if (!record) {
      return;
    }
    const panel = rec(record.playlistPanelRenderer);
    if (panel) {
      out.push(...itemsFrom(arr(panel.contents)));
      return;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'responseContext' || key === 'frameworkUpdates') {
        continue;
      }
      visit(child, depth + 1);
    }
  };
  visit(root.contents, 0);
  return out;
}

export function isSignedOutResponse(response: unknown): boolean {
  for (const service of arr(at(response, 'responseContext', 'serviceTrackingParams'))) {
    for (const param of arr(rec(service)?.params)) {
      const entry = rec(param);
      if (entry && entry.key === 'logged_in' && entry.value === '0') {
        return true;
      }
    }
  }
  return false;
}

export function parseAddToPlaylistTargets(response: unknown, videoId: string): BrowsePage {
  const items: FlatItem[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 30 || items.length >= 500) {
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry, depth + 1);
      }
      return;
    }
    const record = rec(value);
    if (!record) {
      return;
    }
    const option = rec(record.playlistAddToOptionRenderer);
    if (option) {
      const playlistId = typeof option.playlistId === 'string' ? option.playlistId : '';
      const title = textOf(option.title);
      if (/^[A-Za-z0-9_-]{2,128}$/.test(playlistId) && title !== '' && !seen.has(playlistId)) {
        seen.add(playlistId);
        items.push({
          id: `target:${playlistId}`,
          title,
          subtitle: option.containsSelectedVideos === 'ALL' ? 'Already saved' : '',
          artworkUrl: '',
          type: 'playlist',
          playable: false,
          browsable: false,
          videoId: null,
          playlistId,
          browseId: null,
          durationSec: null,
          continuation: null,
        });
      }
      return;
    }
    for (const child of Object.values(record)) {
      visit(child, depth + 1);
    }
  };
  visit(response, 0);
  return { nodeId: `targets:${videoId}`, title: 'Save to playlist', sections: [], items, continuation: null };
}

export function editSucceeded(response: unknown): boolean {
  const record = rec(response);
  if (!record) {
    return false;
  }
  return record.status === undefined || record.status === 'STATUS_SUCCEEDED';
}
