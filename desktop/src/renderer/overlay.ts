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
import type { MenuItemSpec, OverlayRenderPayload, ToastItem } from '../shared/types';

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

function start(): void {
  const api = window.musixOverlay;
  const root = document.getElementById('root');
  if (!api || !root) {
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
