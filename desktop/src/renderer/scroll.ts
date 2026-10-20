const SELECTOR = '[data-scroll]';
const IDLE_MS = 800;

function updateFades(el: HTMLElement): void {
  const top = el.scrollTop > 2;
  const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
  if (el.dataset.fadeTop !== String(top)) {
    el.dataset.fadeTop = String(top);
  }
  if (el.dataset.fadeBottom !== String(bottom)) {
    el.dataset.fadeBottom = String(bottom);
  }
}

export function enhanceScrollArea(el: HTMLElement): void {
  if (el.dataset.scrollReady === 'true') {
    return;
  }
  el.dataset.scrollReady = 'true';
  let timer: number | null = null;
  el.addEventListener(
    'scroll',
    () => {
      el.classList.add('is-scrolling');
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        el.classList.remove('is-scrolling');
      }, IDLE_MS);
      updateFades(el);
    },
    { passive: true },
  );
  const observer = new ResizeObserver(() => {
    updateFades(el);
  });
  observer.observe(el);
  new MutationObserver(() => {
    updateFades(el);
  }).observe(el, { childList: true, subtree: true });
  updateFades(el);
}

export function installScrollAreas(root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(SELECTOR))) {
    enhanceScrollArea(el);
  }
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (node.matches(SELECTOR)) {
          enhanceScrollArea(node);
        }
        for (const child of Array.from(node.querySelectorAll<HTMLElement>(SELECTOR))) {
          enhanceScrollArea(child);
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

export function smoothScrollIntoView(el: Element): void {
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
