import type { ShellApi } from '../shared/channels';
import { TOOLTIP_DELAY_MS } from '../shared/constants';
import type { TooltipPlacement } from '../shared/types';

function placementOf(el: Element): TooltipPlacement {
  const value = el.getAttribute('data-tooltip-placement');
  if (value === 'top' || value === 'bottom' || value === 'left' || value === 'right') {
    return value;
  }
  return 'bottom';
}

function tooltipText(el: Element): string | null {
  const explicit = el.getAttribute('data-tooltip');
  if (explicit !== null && explicit.trim() !== '') {
    return explicit;
  }
  if (el.hasAttribute('data-tooltip-overflow') && el instanceof HTMLElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const text = el.textContent.trim();
      return text === '' ? null : text;
    }
  }
  return null;
}

const SELECTOR = '[data-tooltip], [data-tooltip-overflow]';

export class TooltipController {
  private timer: number | null = null;
  private current: Element | null = null;
  private manual = false;
  private visible = false;

  constructor(private readonly api: ShellApi) {
    document.addEventListener('pointerover', (event) => {
      const target = event.target instanceof Element ? event.target.closest(SELECTOR) : null;
      if (!target || target === this.current) {
        return;
      }
      this.schedule(target, TOOLTIP_DELAY_MS);
    });
    document.addEventListener('pointerout', (event) => {
      if (!this.current || this.manual) {
        return;
      }
      const related = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      if (related && this.current.contains(related)) {
        return;
      }
      if (event.target instanceof Element && this.current.contains(event.target)) {
        this.hide();
      }
    });
    document.addEventListener('focusin', (event) => {
      const target = event.target instanceof Element ? event.target.closest(SELECTOR) : null;
      if (!target || !(event.target instanceof HTMLElement) || !event.target.matches(':focus-visible')) {
        return;
      }
      this.schedule(target, 150);
    });
    document.addEventListener('focusout', () => {
      if (!this.manual) {
        this.hide();
      }
    });
    document.addEventListener('pointerdown', () => {
      this.hide();
    });
    document.addEventListener(
      'scroll',
      () => {
        this.hide();
      },
      true,
    );
    window.addEventListener('blur', () => {
      this.hide();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.hide();
      }
    });
  }

  private schedule(target: Element, delay: number): void {
    this.clearTimer();
    this.manual = false;
    if (this.visible) {
      this.current = target;
      this.showFor(target);
      return;
    }
    this.current = target;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.current === target && target.isConnected) {
        this.showFor(target);
      }
    }, delay);
  }

  private showFor(target: Element): void {
    const text = tooltipText(target);
    if (text === null) {
      this.send(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    this.send({
      text,
      anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      placement: placementOf(target),
    });
  }

  showAt(
    text: string,
    anchor: DOMRect | { left: number; top: number; width: number; height: number },
    placement: TooltipPlacement,
  ): void {
    this.clearTimer();
    this.manual = true;
    this.current = null;
    this.send({
      text,
      anchor: { x: anchor.left, y: anchor.top, width: anchor.width, height: anchor.height },
      placement,
    });
  }

  hide(): void {
    this.clearTimer();
    this.current = null;
    this.manual = false;
    if (this.visible) {
      this.send(null);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private send(
    request: {
      text: string;
      anchor: { x: number; y: number; width: number; height: number };
      placement: TooltipPlacement;
    } | null,
  ): void {
    this.visible = request !== null;
    this.api.send('overlay:tooltip', request);
  }
}
