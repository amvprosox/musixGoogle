import { isTrackChange } from './state-diff';
import type { PlayerState, Rect } from './types';

export interface NotifyInput {
  enabled: boolean;
  windowFocused: boolean;
  prev: PlayerState | null;
  next: PlayerState;
}

export function shouldNotifyTrackChange(input: NotifyInput): boolean {
  if (!input.enabled || input.windowFocused) {
    return false;
  }
  if (input.next.isAd || !input.next.hasTrack || input.next.title === '') {
    return false;
  }
  return isTrackChange(input.prev, input.next);
}

export type MprisDecision = 'start-fallback' | 'stop-fallback' | 'keep';

export interface MprisInput {
  chromiumDetected: boolean;
  fallbackActive: boolean;
  playbackStartedAt: number | null;
  now: number;
  detectWindowMs: number;
}

export function decideMpris(input: MprisInput): MprisDecision {
  if (input.chromiumDetected) {
    return input.fallbackActive ? 'stop-fallback' : 'keep';
  }
  if (input.fallbackActive || input.playbackStartedAt === null) {
    return 'keep';
  }
  if (input.now - input.playbackStartedAt >= input.detectWindowMs) {
    return 'start-fallback';
  }
  return 'keep';
}

export function intersectionArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) {
    return 0;
  }
  return width * height;
}

export function isBoundsVisibleOnDisplays(bounds: Rect, displays: readonly Rect[], minVisible = 64): boolean {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return false;
  }
  const titleBar: Rect = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: Math.min(48, bounds.height),
  };
  return displays.some((display) => {
    const area = intersectionArea(titleBar, display);
    return area >= minVisible * Math.min(48, bounds.height);
  });
}

export function roundRect(rect: Rect): Rect {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  return {
    x,
    y,
    width: Math.max(0, Math.round(rect.x + rect.width) - x),
    height: Math.max(0, Math.round(rect.y + rect.height) - y),
  };
}

export function placeFloating(
  anchor: Rect,
  size: { width: number; height: number },
  placement: 'top' | 'bottom' | 'left' | 'right',
  container: { width: number; height: number },
  gap = 8,
  margin = 8,
): Rect {
  const order: ('top' | 'bottom' | 'left' | 'right')[] =
    placement === 'top'
      ? ['top', 'bottom', 'right', 'left']
      : placement === 'bottom'
        ? ['bottom', 'top', 'right', 'left']
        : placement === 'right'
          ? ['right', 'left', 'bottom', 'top']
          : ['left', 'right', 'bottom', 'top'];
  const candidates = order.map((side) => {
    if (side === 'top' || side === 'bottom') {
      return {
        side,
        x: anchor.x + anchor.width / 2 - size.width / 2,
        y: side === 'top' ? anchor.y - gap - size.height : anchor.y + anchor.height + gap,
      };
    }
    return {
      side,
      x: side === 'left' ? anchor.x - gap - size.width : anchor.x + anchor.width + gap,
      y: anchor.y + anchor.height / 2 - size.height / 2,
    };
  });
  const fits = candidates.find(
    (c) =>
      c.x >= 0 && c.y >= 0 && c.x + size.width <= container.width && c.y + size.height <= container.height,
  );
  const chosen = fits ?? candidates[0] ?? { side: placement, x: anchor.x, y: anchor.y };
  const maxX = Math.max(margin, container.width - size.width - margin);
  const maxY = Math.max(margin, container.height - size.height - margin);
  return roundRect({
    x: Math.min(Math.max(chosen.x, margin), maxX),
    y: Math.min(Math.max(chosen.y, margin), maxY),
    width: size.width,
    height: size.height,
  });
}
