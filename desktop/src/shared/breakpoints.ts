import {
  BREAKPOINT_LG,
  BREAKPOINT_MD,
  BREAKPOINT_SM,
  BREAKPOINT_XL,
  QUEUE_WIDTH_LG,
  QUEUE_WIDTH_XL,
  SIDEBAR_EXPANDED_WIDTH,
  SIDEBAR_RAIL_WIDTH,
} from './constants';

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type SidebarMode = 'expanded' | 'rail' | 'drawer' | 'bottom-nav';
export type QueueMode = 'docked' | 'drawer' | 'sheet';
export type VolumeMode = 'inline' | 'popover' | 'sheet';

export interface LayoutSpec {
  breakpoint: Breakpoint;
  sidebarMode: SidebarMode;
  sidebarWidth: number;
  canCollapseSidebar: boolean;
  queueMode: QueueMode;
  queueWidth: number;
  gridColumns: number;
  compactPlayer: boolean;
  volumeMode: VolumeMode;
  hamburger: boolean;
}

export function resolveBreakpoint(width: number): Breakpoint {
  if (!Number.isFinite(width) || width < BREAKPOINT_SM) {
    return 'xs';
  }
  if (width < BREAKPOINT_MD) {
    return 'sm';
  }
  if (width < BREAKPOINT_LG) {
    return 'md';
  }
  if (width < BREAKPOINT_XL) {
    return 'lg';
  }
  return 'xl';
}

export function layoutFor(breakpoint: Breakpoint, sidebarCollapsed: boolean): LayoutSpec {
  if (breakpoint === 'xl' || breakpoint === 'lg') {
    return {
      breakpoint,
      sidebarMode: sidebarCollapsed ? 'rail' : 'expanded',
      sidebarWidth: sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_EXPANDED_WIDTH,
      canCollapseSidebar: true,
      queueMode: 'docked',
      queueWidth: breakpoint === 'xl' ? QUEUE_WIDTH_XL : QUEUE_WIDTH_LG,
      gridColumns: breakpoint === 'xl' ? 4 : 3,
      compactPlayer: false,
      volumeMode: 'inline',
      hamburger: false,
    };
  }
  if (breakpoint === 'md') {
    return {
      breakpoint,
      sidebarMode: 'rail',
      sidebarWidth: SIDEBAR_RAIL_WIDTH,
      canCollapseSidebar: false,
      queueMode: 'drawer',
      queueWidth: QUEUE_WIDTH_LG,
      gridColumns: 2,
      compactPlayer: false,
      volumeMode: 'inline',
      hamburger: false,
    };
  }
  if (breakpoint === 'sm') {
    return {
      breakpoint,
      sidebarMode: 'drawer',
      sidebarWidth: 0,
      canCollapseSidebar: false,
      queueMode: 'drawer',
      queueWidth: QUEUE_WIDTH_LG,
      gridColumns: 2,
      compactPlayer: false,
      volumeMode: 'popover',
      hamburger: true,
    };
  }
  return {
    breakpoint,
    sidebarMode: 'bottom-nav',
    sidebarWidth: 0,
    canCollapseSidebar: false,
    queueMode: 'sheet',
    queueWidth: 0,
    gridColumns: 1,
    compactPlayer: true,
    volumeMode: 'sheet',
    hamburger: false,
  };
}

export function queueOpenByDefault(breakpoint: Breakpoint, preference: boolean): boolean {
  return breakpoint === 'xl' && preference;
}

export function columnsFor(width: number, maxColumns: number, minColumnWidth = 300, gap = 16): number {
  if (!Number.isFinite(width) || width <= 0) {
    return 1;
  }
  const fit = Math.floor((width + gap) / (minColumnWidth + gap));
  return Math.max(1, Math.min(maxColumns, fit));
}
