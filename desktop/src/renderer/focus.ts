const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hidden || el.closest('[hidden]')) {
      return false;
    }
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  });
}

export function trapFocus(container: HTMLElement, initial?: HTMLElement | null): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') {
      return;
    }
    const items = focusableWithin(container);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);
  const target = initial ?? focusableWithin(container)[0] ?? null;
  window.requestAnimationFrame(() => {
    if (target && container.contains(target)) {
      target.focus({ preventScroll: true });
    } else if (!container.contains(document.activeElement)) {
      container.setAttribute('tabindex', '-1');
      container.focus({ preventScroll: true });
    }
  });
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
  };
}
