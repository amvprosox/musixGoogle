import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron';
import bridgeSource from 'musix-bridge-source';
import tokens from '@musix/design/tokens.json';
import { YTM_ORIGIN } from '../shared/constants';
import { isRecord } from '../shared/guards';
import { NAV_BROWSE_IDS, isSameOrigin, normalizeQuery, ytmRouteUrl, ytmSearchUrl } from '../shared/routes';
import { shouldInterceptInView } from '../shared/shortcuts';
import type {
  DesktopViewCommand,
  DesktopViewEvent,
  ItemMenuInfo,
  ItemTarget,
  KeyPayload,
  MenuAction,
  NavRoute,
} from '../shared/types';
import { isItemMenuInfo, isMenuAction } from '../shared/validators';
import { SCROLLER_SELECTORS, YTM_INJECTED_CSS } from '../shared/ytm-css';
import { installDesktopMainWorld } from './main-world';

const BASE_ARG = '--musix-ytm-base=';
const baseArg = process.argv.find((arg) => arg.startsWith(BASE_ARG));
const base = baseArg ? baseArg.slice(BASE_ARG.length) : YTM_ORIGIN;
const isYtm = isSameOrigin(location.href, base);
const TOOLTIP_DELAY = 400;
const SCROLL_IDLE = tokens.motion.scrollbarFadeOut;
const TEXT_ACTIONS: MenuAction[] = ['cut', 'copy', 'paste', 'selectAll'];
const CHEVRON_LEFT = 'm15 18-6-6 6-6';
const CHEVRON_RIGHT = 'm9 18 6-6-6-6';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAG_THRESHOLD = 10;

function sendDesktop(event: DesktopViewEvent): void {
  ipcRenderer.send('ytm:desktop', event);
}

function runInMainWorld(source: string, userGesture = false): Promise<unknown> {
  return webFrame.executeJavaScript(source, userGesture).catch((error: unknown) => {
    console.warn('[ytm-preload] main world call failed', error);
    return null;
  });
}

function isEditable(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image'].includes(
      target.type,
    );
  }
  return target instanceof HTMLTextAreaElement || target.isContentEditable;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return isEditable(target) || (target instanceof Element && target.closest('ytmusic-search-box') !== null);
}

function newToken(): string {
  return Math.random().toString(36).slice(2, 12).padEnd(8, '0');
}

function toKeyPayload(event: KeyboardEvent): KeyPayload {
  return {
    key: event.key.slice(0, 32),
    code: event.code.slice(0, 32),
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };
}

const REPEATABLE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function installKeyForwarding(): void {
  window.addEventListener(
    'keydown',
    (event) => {
      const payload = toKeyPayload(event);
      const typing = isTypingTarget(event.target);
      if (payload.key === 'Escape') {
        ipcRenderer.send('ytm:key', payload);
        return;
      }
      if (!shouldInterceptInView(payload, typing)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat && !REPEATABLE_KEYS.has(payload.key)) {
        return;
      }
      ipcRenderer.send('ytm:key', payload);
    },
    true,
  );
}

function installInputBlocking(): void {
  window.addEventListener(
    'dragstart',
    (event) => {
      if (!isEditable(event.target)) {
        event.preventDefault();
      }
    },
    true,
  );
  const blockModifiedLinks = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    if (!target) {
      return;
    }
    if (event.button === 1 || event.ctrlKey || event.shiftKey || event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  window.addEventListener('auxclick', blockModifiedLinks, true);
  window.addEventListener('click', blockModifiedLinks, true);
  window.addEventListener(
    'mousedown',
    (event) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    },
    true,
  );
}

function installTooltips(): void {
  const strip = (root: ParentNode): void => {
    const nodes = root instanceof Element && root.hasAttribute('title') ? [root] : [];
    for (const el of [...nodes, ...Array.from(root.querySelectorAll('[title]'))]) {
      const title = el.getAttribute('title') ?? '';
      el.removeAttribute('title');
      if (title.trim() !== '') {
        el.setAttribute('data-musix-title', title.trim().slice(0, 200));
      }
    }
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        strip(record.target);
      }
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element) {
          strip(node);
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title'],
  });
  strip(document);
  let timer: number | null = null;
  let current: Element | null = null;
  const hide = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (current) {
      current = null;
      sendDesktop({ type: 'tooltipHide' });
    }
  };
  document.addEventListener('pointerover', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-musix-title]') : null;
    if (!target || target === current) {
      return;
    }
    hide();
    timer = window.setTimeout(() => {
      timer = null;
      if (!target.isConnected) {
        return;
      }
      const rect = target.getBoundingClientRect();
      current = target;
      sendDesktop({
        type: 'tooltip',
        text: target.getAttribute('data-musix-title') ?? '',
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
    }, TOOLTIP_DELAY);
  });
  document.addEventListener('pointerout', (event) => {
    const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (current && related && current.contains(related)) {
      return;
    }
    hide();
  });
  for (const type of ['pointerdown', 'wheel', 'keydown']) {
    document.addEventListener(type, hide, { capture: true, passive: true });
  }
  window.addEventListener('blur', hide);
}

function installScrollbars(): void {
  const timers = new WeakMap<Element, number>();
  document.addEventListener(
    'scroll',
    (event) => {
      const target = event.target === document ? document.documentElement : event.target;
      if (!(target instanceof Element)) {
        return;
      }
      target.classList.add('musix-scrolling');
      const previous = timers.get(target);
      if (previous !== undefined) {
        window.clearTimeout(previous);
      }
      timers.set(
        target,
        window.setTimeout(() => {
          target.classList.remove('musix-scrolling');
          timers.delete(target);
        }, SCROLL_IDLE),
      );
    },
    { capture: true, passive: true },
  );
}

function chevron(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function enhanceShelf(host: Element, scroller: HTMLElement): void {
  if (host.getAttribute('data-musix-shelf') === 'true') {
    return;
  }
  host.setAttribute('data-musix-shelf', 'true');
  const make = (dir: 'prev' | 'next'): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'musix-shelf-btn';
    button.dataset.dir = dir;
    button.setAttribute('aria-label', dir === 'prev' ? 'Scroll back' : 'Scroll forward');
    button.setAttribute('data-musix-title', dir === 'prev' ? 'Scroll back' : 'Scroll forward');
    button.append(chevron(dir === 'prev' ? CHEVRON_LEFT : CHEVRON_RIGHT));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const page = Math.max(120, scroller.clientWidth * 0.9);
      scroller.scrollBy({ left: dir === 'prev' ? -page : page, behavior: 'smooth' });
    });
    return button;
  };
  const prev = make('prev');
  const next = make('next');
  host.append(prev, next);
  const update = (): void => {
    const max = scroller.scrollWidth - scroller.clientWidth;
    prev.disabled = scroller.scrollLeft <= 1;
    next.disabled = max <= 1 || scroller.scrollLeft >= max - 1;
  };
  scroller.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(scroller);
  update();
}

function scrollableAncestor(start: Element | null): Element | null {
  let node: Element | null = start;
  let depth = 0;
  while (node && node !== document.documentElement && depth < 12) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') {
        return node;
      }
    }
    node = node.parentElement;
    depth += 1;
  }
  return null;
}

function installScrollHover(): void {
  let current: Element | null = null;
  document.addEventListener(
    'pointerover',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const next = scrollableAncestor(target);
      if (next === current) {
        return;
      }
      current?.classList.remove('musix-scroll-hover');
      next?.classList.add('musix-scroll-hover');
      current = next;
    },
    { capture: true, passive: true },
  );
  document.addEventListener('pointerleave', () => {
    current?.classList.remove('musix-scroll-hover');
    current = null;
  });
}

function installShelfDrag(): void {
  const selector = SCROLLER_SELECTORS.join(',');
  let active: {
    scroller: HTMLElement;
    pointerId: number;
    startX: number;
    startLeft: number;
    moved: boolean;
  } | null = null;
  let samples: { x: number; t: number }[] = [];
  let suppressClick = false;
  let glide = 0;
  const stopGlide = (): void => {
    if (glide !== 0) {
      cancelAnimationFrame(glide);
      glide = 0;
    }
  };
  document.addEventListener(
    'pointerdown',
    (event) => {
      stopGlide();
      if (event.button !== 0 || event.pointerType !== 'mouse' || !(event.target instanceof Element)) {
        return;
      }
      const scroller = event.target.closest(selector);
      if (!(scroller instanceof HTMLElement) || scroller.scrollWidth <= scroller.clientWidth + 1) {
        return;
      }
      if (event.target.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      active = {
        scroller,
        pointerId: event.pointerId,
        startX: event.clientX,
        startLeft: scroller.scrollLeft,
        moved: false,
      };
      samples = [{ x: event.clientX, t: event.timeStamp }];
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!active || event.pointerId !== active.pointerId) {
        return;
      }
      const dx = event.clientX - active.startX;
      if (!active.moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD) {
          return;
        }
        active.moved = true;
        active.scroller.classList.add('musix-dragging');
        try {
          active.scroller.setPointerCapture(event.pointerId);
        } catch {
          active.moved = true;
        }
      }
      active.scroller.scrollLeft = active.startLeft - dx;
      samples.push({ x: event.clientX, t: event.timeStamp });
      if (samples.length > 6) {
        samples.shift();
      }
    },
    { capture: true, passive: true },
  );
  const finish = (event: PointerEvent): void => {
    if (!active || event.pointerId !== active.pointerId) {
      return;
    }
    const { scroller, moved, startLeft } = active;
    active = null;
    scroller.classList.remove('musix-dragging');
    if (!moved || Math.abs(scroller.scrollLeft - startLeft) < DRAG_THRESHOLD) {
      return;
    }
    suppressClick = true;
    window.setTimeout(() => {
      suppressClick = false;
    }, 0);
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last || last.t - first.t <= 0) {
      return;
    }
    let velocity = (last.x - first.x) / (last.t - first.t);
    let previous = performance.now();
    const step = (now: number): void => {
      const elapsed = now - previous;
      previous = now;
      scroller.scrollLeft -= velocity * elapsed;
      velocity *= Math.pow(0.95, elapsed / 16);
      glide = Math.abs(velocity) > 0.02 ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  };
  document.addEventListener('pointerup', finish, { capture: true, passive: true });
  document.addEventListener('pointercancel', finish, { capture: true, passive: true });
  document.addEventListener(
    'click',
    (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
      }
    },
    { capture: true },
  );
}

function installShelves(): void {
  const scan = (): void => {
    for (const selector of SCROLLER_SELECTORS.slice(0, 2)) {
      for (const scroller of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const host = scroller.parentElement;
        if (host) {
          enhanceShelf(host, scroller);
        }
      }
    }
  };
  let pending = false;
  new MutationObserver(() => {
    if (pending) {
      return;
    }
    pending = true;
    window.setTimeout(() => {
      pending = false;
      scan();
    }, 300);
  }).observe(document.documentElement, { subtree: true, childList: true });
  scan();
}

const ITEM_SELECTORS = [
  'ytmusic-responsive-list-item-renderer',
  'ytmusic-two-row-item-renderer',
  'ytmusic-player-queue-item',
  'ytmusic-player-bar',
].join(', ');

async function itemInfo(target: ItemTarget): Promise<ItemMenuInfo | null> {
  const raw = await runInMainWorld(
    `window.__musixDesktop ? window.__musixDesktop.info(${JSON.stringify(JSON.stringify(target))}) : 'null'`,
  );
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isItemMenuInfo(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function installContextMenu(ytm: boolean): void {
  window.addEventListener(
    'contextmenu',
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isEditable(event.target)) {
        event.target.focus();
        sendDesktop({
          type: 'contextMenu',
          target: { kind: 'ytmText' },
          x: event.clientX,
          y: event.clientY,
          info: { title: '', actions: TEXT_ACTIONS },
        });
        return;
      }
      if (!ytm) {
        return;
      }
      const item = event.target instanceof Element ? event.target.closest(ITEM_SELECTORS) : null;
      if (!item) {
        return;
      }
      const token = item.getAttribute('data-musix-ctx') ?? newToken();
      item.setAttribute('data-musix-ctx', token);
      const x = event.clientX;
      const y = event.clientY;
      itemInfo({ kind: 'ytm', token })
        .then((info) => {
          if (info && info.actions.length > 0) {
            sendDesktop({ type: 'contextMenu', target: { kind: 'ytm', token }, x, y, info });
          }
        })
        .catch(() => undefined);
    },
    true,
  );
}

function installNavigationSignals(): void {
  document.addEventListener(
    'yt-navigate',
    () => {
      sendDesktop({ type: 'navStart' });
    },
    true,
  );
}

function navigateSource(endpoint: Record<string, unknown>): string {
  return `(function(endpoint){
    var app = document.querySelector('ytmusic-app');
    if (!app) { return false; }
    app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint: endpoint } }));
    return true;
  })(${JSON.stringify(endpoint)})`;
}

async function navigate(route: NavRoute): Promise<void> {
  const ok = await runInMainWorld(
    navigateSource({ browseEndpoint: { browseId: NAV_BROWSE_IDS[route] } }),
    true,
  );
  if (ok !== true) {
    location.assign(ytmRouteUrl(route, base));
  }
}

async function searchPage(query: string): Promise<void> {
  const normalized = normalizeQuery(query);
  if (normalized === '') {
    return;
  }
  const ok = await runInMainWorld(navigateSource({ searchEndpoint: { query: normalized } }), true);
  if (ok !== true) {
    location.assign(ytmSearchUrl(normalized, base));
  }
}

function signIn(): void {
  const link =
    document.querySelector('ytmusic-nav-bar a.sign-in-link') ?? document.querySelector('a.sign-in-link');
  if (link instanceof HTMLAnchorElement && link.href.startsWith('https://')) {
    location.assign(link.href);
    return;
  }
  const next = encodeURIComponent(`${base}/`);
  location.assign(
    `https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=${encodeURIComponent(
      `https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=${next}`,
    )}`,
  );
}

async function itemAction(target: ItemTarget, action: MenuAction): Promise<void> {
  const raw = await runInMainWorld(
    `window.__musixDesktop ? window.__musixDesktop.act(${JSON.stringify(JSON.stringify(target))}, ${JSON.stringify(action)}) : '{"ok":false}'`,
    true,
  );
  if (action !== 'copyLink' || typeof raw !== 'string') {
    return;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.url === 'string') {
      sendDesktop({ type: 'link', url: parsed.url });
    }
  } catch {
    return;
  }
}

async function runDesktopCommand(command: DesktopViewCommand): Promise<void> {
  switch (command.type) {
    case 'navigate':
      await navigate(command.route);
      return;
    case 'searchPage':
      await searchPage(command.query);
      return;
    case 'signIn':
      signIn();
      return;
    case 'openAccountMenu': {
      const button = document.querySelector('ytmusic-settings-button');
      if (button instanceof HTMLElement) {
        button.click();
      }
      return;
    }
    case 'itemInfo':
      sendDesktop({ type: 'itemInfo', requestId: command.requestId, info: await itemInfo(command.target) });
      return;
    case 'itemAction':
      if (isMenuAction(command.action)) {
        await itemAction(command.target, command.action);
      }
      return;
  }
}

function insertStyles(): void {
  webFrame.insertCSS(YTM_INJECTED_CSS);
}

function watchHead(): void {
  let head = document.head;
  new MutationObserver(() => {
    if (document.head !== head) {
      head = document.head;
      insertStyles();
    }
  }).observe(document.documentElement, { childList: true });
}

contextBridge.exposeInMainWorld('electronBridge', {
  send: (json: unknown) => {
    if (typeof json === 'string' && json.length <= 4_000_000) {
      ipcRenderer.send('ytm:message', json);
    }
  },
  dialog: (kind: unknown, message: unknown) => {
    if ((kind === 'alert' || kind === 'confirm' || kind === 'prompt') && typeof message === 'string') {
      sendDesktop({ type: 'dialog', kind, message: message.slice(0, 2000) });
    }
  },
});

installInputBlocking();
installContextMenu(isYtm);

if (isYtm) {
  insertStyles();
  installKeyForwarding();
  void runInMainWorld(`(${installDesktopMainWorld.toString()})();`);
  void runInMainWorld(bridgeSource);
  ipcRenderer.on('ytm:command', (_event: IpcRendererEvent, json: unknown) => {
    if (typeof json !== 'string') {
      return;
    }
    void runInMainWorld(
      `window.__musixBridge ? window.__musixBridge.receive(${JSON.stringify(json)}) : false`,
    );
  });
  ipcRenderer.on('ytm:desktop-command', (_event: IpcRendererEvent, command: DesktopViewCommand) => {
    runDesktopCommand(command).catch((error: unknown) => {
      console.warn('[ytm-preload] desktop command failed', error);
    });
  });
  const start = (): void => {
    watchHead();
    installTooltips();
    installScrollbars();
    installScrollHover();
    installShelves();
    installShelfDrag();
    installNavigationSignals();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
