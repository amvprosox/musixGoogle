import { columnsFor } from '../../shared/breakpoints';
import { h } from '../dom';

export function contentSkeleton(columns: number): HTMLElement {
  const cards = Array.from({ length: Math.max(2, columns * 2) }, () =>
    h('div', { className: 'skeleton-card' }, [
      h('div', { className: 'skeleton skeleton-art' }),
      h('div', { className: 'skeleton skeleton-line' }),
      h('div', { className: 'skeleton skeleton-line short' }),
    ]),
  );
  const grid = h('div', { className: 'content-grid' }, cards);
  new ResizeObserver(() => {
    const width = grid.getBoundingClientRect().width;
    grid.style.setProperty('--grid-cols', String(columnsFor(width, columns, 160)));
  }).observe(grid);
  return h(
    'div',
    {
      className: 'content-skeleton',
      attrs: { id: 'content-skeleton', 'aria-busy': 'true', 'aria-label': 'Loading YouTube Music' },
    },
    [
      h(
        'div',
        { className: 'skeleton-chips' },
        Array.from({ length: 6 }, () => h('div', { className: 'skeleton skeleton-chip' })),
      ),
      h('div', { className: 'skeleton skeleton-heading' }),
      grid,
    ],
  );
}
