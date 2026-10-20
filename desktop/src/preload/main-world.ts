export function installDesktopMainWorld(): void {
  type Bag = Record<string, unknown>;
  type Target = { kind: 'ytm'; token: string } | { kind: 'queue'; index: number } | { kind: 'player' };
  const win = window as unknown as Bag;
  if (win.__musixDesktop) {
    return;
  }
  const bridge = win.electronBridge as { dialog?: (kind: string, message: string) => void } | undefined;
  const describe = (message: unknown): string => {
    if (typeof message === 'string') {
      return message;
    }
    if (message === undefined || message === null) {
      return '';
    }
    if (typeof message === 'number' || typeof message === 'boolean' || typeof message === 'bigint') {
      return message.toString();
    }
    try {
      return typeof message === 'function' || typeof message === 'symbol' ? '' : JSON.stringify(message);
    } catch {
      return '';
    }
  };
  const show = (kind: string, message: unknown): void => {
    try {
      if (bridge && typeof bridge.dialog === 'function') {
        bridge.dialog(kind, describe(message));
      }
    } catch {
      return;
    }
  };
  win.alert = (message?: unknown) => {
    show('alert', message);
  };
  win.confirm = (message?: unknown) => {
    show('confirm', message);
    return false;
  };
  win.prompt = (message?: unknown) => {
    show('prompt', message);
    return null;
  };

  const rec = (value: unknown): Bag | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Bag) : null;
  const at = (value: unknown, ...path: string[]): unknown => {
    let current: unknown = value;
    for (const key of path) {
      const record = rec(current);
      if (!record) {
        return undefined;
      }
      current = record[key];
    }
    return current;
  };
  const playerBar = (): Element | null =>
    document.querySelector('ytmusic-player-bar[slot="player-bar"]') ??
    document.querySelector('ytmusic-player-bar');
  const findTarget = (target: Target): Element | null => {
    if (target.kind === 'ytm') {
      return document.querySelector(`[data-musix-ctx="${target.token}"]`);
    }
    if (target.kind === 'queue') {
      const items = Array.from(
        document.querySelectorAll('ytmusic-player-queue ytmusic-player-queue-item'),
      ).filter((el) => el.closest('#counterpart-renderer') === null);
      return items[target.index] ?? null;
    }
    return playerBar();
  };
  const menuEntries = (el: Element): Bag[] => {
    const data = rec((el as unknown as Bag).data);
    const fromData = at(data, 'menu', 'menuRenderer', 'items');
    const menuEl = el.querySelector('ytmusic-menu-renderer');
    const fromMenu = menuEl ? at((menuEl as unknown as Bag).data, 'items') : undefined;
    const list = Array.isArray(fromData) ? fromData : Array.isArray(fromMenu) ? fromMenu : [];
    return list.map((entry) => rec(entry)).filter((entry): entry is Bag => entry !== null);
  };
  const entryEndpoint = (entry: Bag): Bag | null => {
    for (const key of Object.keys(entry)) {
      const inner = rec(entry[key]);
      if (!inner) {
        continue;
      }
      const endpoint = rec(inner.serviceEndpoint) ?? rec(inner.navigationEndpoint);
      if (endpoint) {
        return endpoint;
      }
    }
    return null;
  };
  const findEndpoint = (el: Element, action: string): Bag | null => {
    for (const entry of menuEntries(el)) {
      const endpoint = entryEndpoint(entry);
      if (!endpoint) {
        continue;
      }
      const position = at(endpoint, 'queueAddEndpoint', 'queueInsertPosition');
      const pageType = at(
        endpoint,
        'browseEndpoint',
        'browseEndpointContextSupportedConfigs',
        'browseEndpointContextMusicConfig',
        'pageType',
      );
      if (action === 'playNext' && position === 'INSERT_AFTER_CURRENT_VIDEO') {
        return endpoint;
      }
      if (action === 'addToQueue' && position === 'INSERT_AT_END') {
        return endpoint;
      }
      if (action === 'goArtist' && typeof pageType === 'string' && pageType.includes('ARTIST')) {
        return endpoint;
      }
      if (action === 'goAlbum' && typeof pageType === 'string' && pageType.includes('ALBUM')) {
        return endpoint;
      }
    }
    return null;
  };
  const likeButton = (el: Element): HTMLElement | null => {
    const button =
      el.querySelector('#button-shape-like button') ??
      el.querySelector('ytmusic-like-button-renderer button[aria-label="Like"]') ??
      el.querySelector('ytmusic-like-button-renderer .like');
    return button instanceof HTMLElement ? button : null;
  };
  const videoIdOf = (el: Element): string | null => {
    const data = rec((el as unknown as Bag).data);
    const candidates = [
      at(data, 'playlistItemData', 'videoId'),
      at(data, 'videoId'),
      at(data, 'navigationEndpoint', 'watchEndpoint', 'videoId'),
      at(
        data,
        'overlay',
        'musicItemThumbnailOverlayRenderer',
        'content',
        'musicPlayButtonRenderer',
        'playNavigationEndpoint',
        'watchEndpoint',
        'videoId',
      ),
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(candidate)) {
        return candidate;
      }
    }
    const attr = el.getAttribute('data-video-id');
    if (attr && /^[A-Za-z0-9_-]{6,20}$/.test(attr)) {
      return attr;
    }
    if (el.matches('ytmusic-player-bar')) {
      const link = document.querySelector('#movie_player .ytp-title-link');
      const href = link instanceof HTMLAnchorElement ? link.href : location.href;
      try {
        const id = new URL(href).searchParams.get('v');
        return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
      } catch {
        return null;
      }
    }
    return null;
  };
  const linkFor = (el: Element): string | null => {
    const videoId = videoIdOf(el);
    if (videoId) {
      return `https://music.youtube.com/watch?v=${videoId}`;
    }
    const browseId = at((el as unknown as Bag).data, 'navigationEndpoint', 'browseEndpoint', 'browseId');
    if (typeof browseId !== 'string' || !/^[A-Za-z0-9_-]{2,128}$/.test(browseId)) {
      return null;
    }
    if (browseId.startsWith('VL')) {
      return `https://music.youtube.com/playlist?list=${browseId.slice(2)}`;
    }
    if (browseId.startsWith('UC')) {
      return `https://music.youtube.com/channel/${browseId}`;
    }
    return `https://music.youtube.com/browse/${browseId}`;
  };
  const titleFor = (el: Element): string => {
    const node = el.querySelector('.title, .song-title, yt-formatted-string.title');
    return (node?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  };
  const resolve = (endpoint: Bag): boolean => {
    const app = document.querySelector('ytmusic-app') as unknown as {
      resolveCommand?: (command: Bag) => unknown;
    } | null;
    if (app && typeof app.resolveCommand === 'function') {
      app.resolveCommand(endpoint);
      return true;
    }
    if (app) {
      (app as unknown as Element).dispatchEvent(
        new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } }),
      );
      return true;
    }
    return false;
  };
  const info = (raw: string): string => {
    try {
      const target = JSON.parse(raw) as Target;
      const el = findTarget(target);
      if (!el) {
        return 'null';
      }
      const actions: string[] = [];
      for (const action of ['playNext', 'addToQueue']) {
        if (findEndpoint(el, action)) {
          actions.push(action);
        }
      }
      if (likeButton(el)) {
        actions.push('like');
      }
      for (const action of ['goArtist', 'goAlbum']) {
        if (findEndpoint(el, action)) {
          actions.push(action);
        }
      }
      if (linkFor(el)) {
        actions.push('copyLink');
      }
      return JSON.stringify({ title: titleFor(el), actions });
    } catch {
      return 'null';
    }
  };
  const act = (raw: string, action: string): string => {
    try {
      const target = JSON.parse(raw) as Target;
      const el = findTarget(target);
      if (!el) {
        return JSON.stringify({ ok: false });
      }
      if (action === 'copyLink') {
        const url = linkFor(el);
        return JSON.stringify({ ok: url !== null, url });
      }
      if (action === 'like') {
        const button = likeButton(el);
        if (!button) {
          return JSON.stringify({ ok: false });
        }
        button.click();
        return JSON.stringify({ ok: true });
      }
      const endpoint = findEndpoint(el, action);
      return JSON.stringify({ ok: endpoint !== null && resolve(endpoint) });
    } catch {
      return JSON.stringify({ ok: false });
    }
  };
  Object.defineProperty(win, '__musixDesktop', { value: { info, act }, configurable: true });
}
