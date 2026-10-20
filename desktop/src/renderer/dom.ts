import { hydrateIcons, iconElement, setIcon, type IconName } from './icons';

type Child = Node | string | null | undefined | false;

export interface ElementOptions {
  className?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  text?: string;
  dataset?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options.className) {
    el.className = options.className;
  }
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      el.dataset[key] = value;
    }
  }
  if (options.text !== undefined) {
    el.textContent = options.text;
  }
  if (options.on) {
    for (const [type, handler] of Object.entries(options.on)) {
      if (typeof handler === 'function') {
        el.addEventListener(type, handler as EventListener);
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    el.append(child);
  }
  return el;
}

export function icon(name: IconName): HTMLElement {
  const wrap = h('span', { className: 'icon', attrs: { 'aria-hidden': 'true' } });
  wrap.dataset.icon = name;
  wrap.append(iconElement(name));
  return wrap;
}

export function iconButton(options: {
  icon: IconName;
  label: string;
  className?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  onClick: (event: MouseEvent) => void;
  attrs?: Record<string, string>;
}): HTMLButtonElement {
  const button = h(
    'button',
    {
      className: `icon-btn${options.className ? ` ${options.className}` : ''}`,
      attrs: {
        type: 'button',
        'aria-label': options.label,
        'data-tooltip': options.label,
        'data-tooltip-placement': options.placement ?? 'bottom',
        ...(options.attrs ?? {}),
      },
      on: { click: options.onClick },
    },
    [icon(options.icon)],
  );
  return button;
}

export function setButtonIcon(button: HTMLElement, name: IconName): void {
  const holder = button.querySelector<HTMLElement>('.icon');
  if (!holder) {
    return;
  }
  setIcon(holder, name);
}

export function setLabel(button: HTMLElement, label: string): void {
  if (button.getAttribute('aria-label') !== label) {
    button.setAttribute('aria-label', label);
    button.setAttribute('data-tooltip', label);
  }
}

export function setText(el: Element | null, text: string): void {
  if (!el) {
    return;
  }
  if (el.textContent !== text) {
    el.textContent = text;
  }
}

export function setAttr(el: Element | null, name: string, value: string | null): void {
  if (!el) {
    return;
  }
  if (value === null) {
    if (el.hasAttribute(name)) {
      el.removeAttribute(name);
    }
    return;
  }
  if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

export function setImage(img: HTMLImageElement | null, url: string, alt: string): void {
  if (!img) {
    return;
  }
  if (img.alt !== alt) {
    img.alt = alt;
  }
  if (url === '') {
    if (img.hasAttribute('src')) {
      img.removeAttribute('src');
    }
    img.hidden = true;
    return;
  }
  img.hidden = false;
  if (img.getAttribute('src') !== url) {
    img.src = url;
  }
}

export function byId<T extends HTMLElement>(id: string, type: new () => T): T | null {
  const el = document.getElementById(id);
  return el instanceof type ? el : null;
}

export function hydrate(root: Element): void {
  hydrateIcons(root);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    const textTypes = ['text', 'search', 'email', 'url', 'password', 'tel', 'number'];
    return textTypes.includes(target.type);
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

export function isActivationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return (
    target.closest(
      'button, a[href], [role="button"], [role="switch"], [role="radio"], [role="menuitem"], tr[tabindex]',
    ) !== null
  );
}

export function isSliderTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="slider"]') !== null;
}
