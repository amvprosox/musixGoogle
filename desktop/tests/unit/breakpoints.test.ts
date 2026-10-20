import { describe, expect, it } from 'vitest';
import { columnsFor, layoutFor, queueOpenByDefault, resolveBreakpoint } from '../../src/shared/breakpoints';

describe('resolveBreakpoint', () => {
  it('maps widths to breakpoints at the documented boundaries', () => {
    expect(resolveBreakpoint(360)).toBe('xs');
    expect(resolveBreakpoint(719)).toBe('xs');
    expect(resolveBreakpoint(720)).toBe('sm');
    expect(resolveBreakpoint(959)).toBe('sm');
    expect(resolveBreakpoint(960)).toBe('md');
    expect(resolveBreakpoint(1199)).toBe('md');
    expect(resolveBreakpoint(1200)).toBe('lg');
    expect(resolveBreakpoint(1439)).toBe('lg');
    expect(resolveBreakpoint(1440)).toBe('xl');
    expect(resolveBreakpoint(2560)).toBe('xl');
    expect(resolveBreakpoint(Number.NaN)).toBe('xs');
  });
});

describe('layoutFor', () => {
  it('describes XL', () => {
    const layout = layoutFor('xl', false);
    expect(layout.sidebarMode).toBe('expanded');
    expect(layout.sidebarWidth).toBe(240);
    expect(layout.queueMode).toBe('docked');
    expect(layout.queueWidth).toBe(360);
    expect(layout.gridColumns).toBe(4);
  });

  it('describes LG and collapsing', () => {
    expect(layoutFor('lg', false).queueWidth).toBe(320);
    expect(layoutFor('lg', false).gridColumns).toBe(3);
    expect(layoutFor('lg', true).sidebarMode).toBe('rail');
    expect(layoutFor('lg', true).sidebarWidth).toBe(72);
  });

  it('describes MD', () => {
    const layout = layoutFor('md', false);
    expect(layout.sidebarMode).toBe('rail');
    expect(layout.queueMode).toBe('drawer');
    expect(layout.gridColumns).toBe(2);
    expect(layout.canCollapseSidebar).toBe(false);
  });

  it('describes SM', () => {
    const layout = layoutFor('sm', false);
    expect(layout.sidebarMode).toBe('drawer');
    expect(layout.hamburger).toBe(true);
    expect(layout.volumeMode).toBe('popover');
  });

  it('describes XS', () => {
    const layout = layoutFor('xs', false);
    expect(layout.sidebarMode).toBe('bottom-nav');
    expect(layout.compactPlayer).toBe(true);
    expect(layout.queueMode).toBe('sheet');
  });

  it('opens the queue by default only on XL', () => {
    expect(queueOpenByDefault('xl', true)).toBe(true);
    expect(queueOpenByDefault('xl', false)).toBe(false);
    expect(queueOpenByDefault('lg', true)).toBe(false);
  });
});

describe('columnsFor', () => {
  it('caps breakpoint columns by the available width', () => {
    expect(columnsFor(1900, 4)).toBe(4);
    expect(columnsFor(800, 4)).toBe(2);
    expect(columnsFor(1000, 3)).toBe(3);
    expect(columnsFor(500, 2)).toBe(1);
    expect(columnsFor(0, 4)).toBe(1);
    expect(columnsFor(Number.NaN, 4)).toBe(1);
  });
});
