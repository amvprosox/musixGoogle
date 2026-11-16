import {
  CircleCheck,
  CircleX,
  ClipboardPaste,
  Copy,
  createIcons,
  Disc3,
  Heart,
  Info,
  Link,
  ListPlus,
  ListStart,
  MicVocal,
  ScanText,
  Scissors,
  TriangleAlert,
  X,
} from 'lucide';
import type { MenuItemSpec, OverlayRenderPayload, ToastItem, VoiceGlowPayload } from '../shared/types';

const OVERLAY_ICONS = {
  CircleCheck,
  CircleX,
  ClipboardPaste,
  Copy,
  Disc3,
  Heart,
  Info,
  Link,
  ListPlus,
  ListStart,
  MicVocal,
  ScanText,
  Scissors,
  TriangleAlert,
  X,
};

const VARIANT_ICON: Record<ToastItem['variant'], string> = {
  success: 'circle-check',
  warning: 'triangle-alert',
  error: 'circle-x',
  info: 'info',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function iconHolder(name: string): HTMLElement {
  const holder = document.createElement('i');
  holder.setAttribute('data-lucide', name);
  return holder;
}

const WAVE_BARS = 32;

function startVoice(api: NonNullable<Window['musixOverlay']>): void {
  document.documentElement.classList.add('voice-layer');
  const stage = el('div', 'voice-stage');
  const ring = el('div', 'voice-ring');
  stage.append(ring);
  const wave = el('div', 'voice-wave');
  const bars = el('div', 'voice-bars');
  const heights: number[] = Array.from({ length: WAVE_BARS }, () => 0);
  const barNodes = heights.map(() => {
    const bar = el('span', 'voice-bar');
    bars.append(bar);
    return bar;
  });
  const label = el('span', 'voice-label');
  const note = el('span', 'voice-note');
  wave.append(bars, label, note);
  document.body.append(stage);
  let part = '';
  // Bars glide toward their targets every frame, so they never freeze or jump:
  // live mic level while listening, a travelling wave while thinking, and a soft
  // breathing wave while the heard command is on screen and fading out.
  let mode: 'listening' | 'thinking' | 'done' | 'idle' = 'idle';
  const current: number[] = heights.map(() => 0.08);
  let frame = 0;
  let idleSince = 0;
  const middle = (WAVE_BARS - 1) / 2;
  const tick = (now: number): void => {
    let moving = false;
    for (const [index, bar] of barNodes.entries()) {
      const shape = 1 - Math.abs(index - middle) / (middle + 2);
      let target: number;
      if (mode === 'listening') {
        const value = heights[index] ?? 0;
        target = (0.15 + value * 3.2) * (0.45 + shape * 0.55);
      } else if (mode === 'thinking') {
        target = 0.22 + 0.32 * shape * (0.5 + 0.5 * Math.sin(now / 170 - index * 0.45));
      } else if (mode === 'done') {
        target = 0.12 + 0.14 * shape * (0.5 + 0.5 * Math.sin(now / 320 - index * 0.3));
      } else {
        target = 0.08;
      }
      target = Math.max(0.08, Math.min(1, target));
      const prev = current[index] ?? 0.08;
      const next = prev + (target - prev) * 0.18;
      current[index] = next;
      if (Math.abs(target - next) > 0.002) {
        moving = true;
      }
      bar.style.transform = `scaleY(${next.toFixed(3)})`;
    }
    if (mode === 'idle' && !moving) {
      idleSince = idleSince === 0 ? now : idleSince;
    } else {
      idleSince = 0;
    }
    frame = mode === 'idle' && idleSince !== 0 && now - idleSince > 600 ? 0 : requestAnimationFrame(tick);
  };
  const wake = (): void => {
    if (frame === 0) {
      frame = requestAnimationFrame(tick);
    }
  };
  api.onRender((payload: OverlayRenderPayload) => {
    if (payload.kind !== 'voice') {
      return;
    }
    const voice: VoiceGlowPayload = payload;
    if (voice.part !== part) {
      part = voice.part;
      stage.replaceChildren(voice.part === 'wave' ? wave : ring);
    }
    stage.dataset.active = voice.active ? 'true' : 'false';
    stage.dataset.caption = voice.caption === '' ? 'false' : 'true';
    stage.dataset.thinking = voice.thinking ? 'true' : 'false';
    stage.style.setProperty('--voice-level', voice.level.toFixed(3));
    ring.style.width = `${voice.windowWidth}px`;
    ring.style.height = `${voice.windowHeight}px`;
    ring.style.left = `${-voice.x}px`;
    ring.style.top = `${-voice.y}px`;
    if (voice.part === 'wave') {
      heights.shift();
      heights.push(voice.active ? voice.level : 0);
      mode = voice.thinking
        ? 'thinking'
        : voice.active
          ? 'listening'
          : voice.caption !== ''
            ? 'done'
            : 'idle';
      wake();
      if (voice.caption !== '') {
        label.textContent = `\u201c${voice.caption}\u201d`;
        note.textContent = voice.thinking ? 'Thinking\u2026' : voice.note;
      } else if (voice.active || voice.thinking) {
        label.textContent = voice.thinking ? 'Thinking\u2026' : 'Listening\u2026';
        note.textContent = '';
      }
    }
  });
}

function start(): void {
  const api = window.musixOverlay;
  const root = document.getElementById('root');
  if (!api || !root) {
    return;
  }
  if (new URLSearchParams(window.location.search).get('layer') === 'voice') {
    startVoice(api);
    return;
  }
  let lastWidth = -1;
  let lastHeight = -1;

  const report = (): void => {
    const rect = root.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    if (width === lastWidth && height === lastHeight) {
      return;
    }
    lastWidth = width;
    lastHeight = height;
    api.reportSize({ width, height });
  };

  const renderToast = (toast: ToastItem): HTMLElement => {
    const item = el('div', 'toast');
    item.dataset.variant = toast.variant;
    item.setAttribute('role', toast.variant === 'error' ? 'alert' : 'status');
    const iconWrap = el('span', 'toast-icon');
    iconWrap.append(iconHolder(VARIANT_ICON[toast.variant]));
    const text = el('div', 'toast-text');
    text.append(el('span', 'toast-title', toast.title));
    if (toast.message !== '') {
      text.append(el('span', 'toast-message', toast.message));
    }
    const close = el('button', 'toast-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.append(iconHolder('x'));
    close.addEventListener('click', () => {
      api.dismissToast(toast.id);
    });
    item.append(iconWrap, text, close);
    return item;
  };

  let menuKeyHandler: ((event: KeyboardEvent) => void) | null = null;
  document.addEventListener('keydown', (event) => {
    if (menuKeyHandler) {
      menuKeyHandler(event);
    }
  });

  const renderMenu = (title: string, items: MenuItemSpec[]): HTMLElement => {
    const menu = el('div', 'menu');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', title === '' ? 'Actions' : title);
    if (title !== '') {
      menu.append(el('div', 'menu-title', title));
    }
    const buttons: HTMLButtonElement[] = [];
    for (const item of items) {
      const button = el('button', 'menu-item');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.id = item.id;
      button.disabled = item.disabled;
      const icon = el('span', 'menu-icon');
      icon.append(iconHolder(item.icon));
      button.append(icon, el('span', 'menu-label', item.label));
      button.addEventListener('click', () => {
        if (!button.disabled) {
          api.selectMenuItem(item.id);
        }
      });
      buttons.push(button);
      menu.append(button);
    }
    const enabled = (): HTMLButtonElement[] => buttons.filter((button) => !button.disabled);
    menuKeyHandler = (event: KeyboardEvent): void => {
      const list = enabled();
      const index = list.findIndex((button) => button === document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = list[(index + step + list.length) % list.length];
        if (next) {
          next.focus();
        }
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const target = event.key === 'Home' ? list[0] : list[list.length - 1];
        if (target) {
          target.focus();
        }
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        api.closeMenu();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const target = index >= 0 ? list[index] : list[0];
        if (target) {
          target.click();
        }
      }
    };
    window.requestAnimationFrame(() => {
      const first = enabled()[0];
      if (first) {
        first.focus();
      }
    });
    return menu;
  };

  const render = (payload: OverlayRenderPayload): void => {
    if (payload.kind !== 'menu') {
      menuKeyHandler = null;
    }
    if (payload.kind === 'voice') {
      return;
    }
    if (payload.kind === 'clear') {
      root.replaceChildren();
      lastWidth = -1;
      lastHeight = -1;
      api.reportSize({ width: 0, height: 0 });
      return;
    }
    document.documentElement.dataset.theme = payload.theme;
    if (payload.kind === 'tooltip') {
      const tip = el('div', 'tooltip', payload.text);
      tip.setAttribute('role', 'tooltip');
      root.replaceChildren(tip);
    } else if (payload.kind === 'menu') {
      root.replaceChildren(renderMenu(payload.title, payload.items));
      createIcons({ icons: OVERLAY_ICONS, root, attrs: { 'aria-hidden': 'true' } });
    } else {
      const stack = el('div', 'toast-stack');
      stack.style.width = `${Math.floor(payload.maxWidth)}px`;
      stack.style.maxWidth = `${Math.floor(payload.maxWidth)}px`;
      for (const toast of payload.toasts) {
        stack.append(renderToast(toast));
      }
      root.replaceChildren(stack);
      createIcons({ icons: OVERLAY_ICONS, root, attrs: { 'aria-hidden': 'true' } });
    }
    report();
  };

  api.onRender(render);
  const observer = new ResizeObserver(() => {
    report();
  });
  observer.observe(root);
  document.fonts.ready
    .then(() => {
      report();
    })
    .catch(() => undefined);
}

start();
