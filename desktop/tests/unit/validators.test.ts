import { describe, expect, it } from 'vitest';
import { EMPTY_PLAYER_STATE } from '../../src/shared/state-diff';
import {
  isAccountState,
  isHistoryDirection,
  isKeyPayload,
  isOverlayRenderPayload,
  isOverlaySize,
  isPlayerCommand,
  isPlayerState,
  isQueueItems,
  isRect,
  isToastLayerRequest,
  isTooltipRequest,
  isViewLayout,
} from '../../src/shared/validators';

describe('IPC payload validators', () => {
  it('validates player commands', () => {
    expect(isPlayerCommand({ type: 'play' })).toBe(true);
    expect(isPlayerCommand({ type: 'seekTo', seconds: 12.5 })).toBe(true);
    expect(isPlayerCommand({ type: 'seekTo', seconds: -1 })).toBe(false);
    expect(isPlayerCommand({ type: 'seekTo', seconds: Number.NaN })).toBe(false);
    expect(isPlayerCommand({ type: 'setVolume', volume: 0.4 })).toBe(true);
    expect(isPlayerCommand({ type: 'setVolume', volume: 2 })).toBe(false);
    expect(isPlayerCommand({ type: 'playQueueIndex', index: 3 })).toBe(true);
    expect(isPlayerCommand({ type: 'playQueueIndex', index: 1.5 })).toBe(false);
    expect(isPlayerCommand({ type: 'search', query: 'daft punk' })).toBe(true);
    expect(isPlayerCommand({ type: 'search', query: '   ' })).toBe(false);
    expect(isPlayerCommand({ type: 'search', query: 'x'.repeat(501) })).toBe(false);
    expect(isPlayerCommand({ type: 'navigate', route: 'liked' })).toBe(true);
    expect(isPlayerCommand({ type: 'navigate', route: 'admin' })).toBe(false);
    expect(isPlayerCommand({ type: 'eval', code: '1' })).toBe(false);
    expect(isPlayerCommand(null)).toBe(false);
    expect(isPlayerCommand('play')).toBe(false);
  });

  it('validates player state', () => {
    expect(isPlayerState(EMPTY_PLAYER_STATE)).toBe(true);
    expect(isPlayerState({ ...EMPTY_PLAYER_STATE, volume: 1.5 })).toBe(false);
    expect(isPlayerState({ ...EMPTY_PLAYER_STATE, likeStatus: 'LOVE' })).toBe(false);
    expect(isPlayerState({ ...EMPTY_PLAYER_STATE, repeatMode: 'SOME' })).toBe(false);
    expect(isPlayerState({ ...EMPTY_PLAYER_STATE, title: 5 })).toBe(false);
    const missing: Record<string, unknown> = { ...EMPTY_PLAYER_STATE };
    delete missing.isAd;
    expect(isPlayerState(missing)).toBe(false);
  });

  it('validates queue items', () => {
    const item = { index: 0, thumbnailUrl: '', title: 'a', artist: 'b', duration: '3:00', isCurrent: true };
    expect(isQueueItems([item])).toBe(true);
    expect(isQueueItems([{ ...item, index: -1 }])).toBe(false);
    expect(isQueueItems('x')).toBe(false);
    expect(isQueueItems(Array.from({ length: 1001 }, (_, index) => ({ ...item, index })))).toBe(false);
  });

  it('validates layout geometry', () => {
    expect(isRect({ x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(isRect({ x: 0, y: 0, width: -1, height: 10 })).toBe(false);
    expect(isRect({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 })).toBe(false);
    expect(isViewLayout({ bounds: { x: 1, y: 2, width: 3, height: 4 }, visible: true })).toBe(true);
    expect(isViewLayout({ bounds: { x: 1, y: 2, width: 3, height: 4 } })).toBe(false);
  });

  it('validates misc payloads', () => {
    expect(isAccountState({ signedIn: true, avatarUrl: 'https://x' })).toBe(true);
    expect(isAccountState({ signedIn: 'yes', avatarUrl: '' })).toBe(false);
    expect(
      isKeyPayload({
        key: ' ',
        code: 'Space',
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(true);
    expect(isKeyPayload({ key: ' ', code: 'Space' })).toBe(false);
    expect(isHistoryDirection('back')).toBe(true);
    expect(isHistoryDirection('up')).toBe(false);
    expect(
      isTooltipRequest({ text: 'Play', anchor: { x: 1, y: 1, width: 1, height: 1 }, placement: 'top' }),
    ).toBe(true);
    expect(
      isTooltipRequest({ text: '', anchor: { x: 1, y: 1, width: 1, height: 1 }, placement: 'top' }),
    ).toBe(false);
    expect(
      isTooltipRequest({ text: 'a', anchor: { x: 1, y: 1, width: 1, height: 1 }, placement: 'middle' }),
    ).toBe(false);
    const toast = { id: 't1', variant: 'success', title: 'Done', message: '' };
    expect(isToastLayerRequest({ toasts: [toast], right: 16, bottom: 100 })).toBe(true);
    expect(isToastLayerRequest({ toasts: [{ ...toast, variant: 'loud' }], right: 16, bottom: 100 })).toBe(
      false,
    );
    expect(isOverlaySize({ width: 10, height: 20 })).toBe(true);
    expect(isOverlaySize({ width: -1, height: 20 })).toBe(false);
    expect(isOverlayRenderPayload({ kind: 'clear' })).toBe(true);
    expect(isOverlayRenderPayload({ kind: 'tooltip', text: 'x', theme: 'dark' })).toBe(true);
    expect(isOverlayRenderPayload({ kind: 'toasts', toasts: [toast], theme: 'light', maxWidth: 300 })).toBe(
      true,
    );
    expect(isOverlayRenderPayload({ kind: 'toasts', toasts: [toast], theme: 'light' })).toBe(false);
  });
});
