import { resolveShortcut, type ShortcutAction } from '../shared/shortcuts';
import type { KeyPayload } from '../shared/types';
import type { PlayerActions } from './actions';
import { isActivationTarget, isSliderTarget, isTypingTarget } from './dom';

export interface ShortcutHandlers {
  actions: PlayerActions;
  focusSearch: () => void;
  openSettings: () => void;
  escape: () => boolean;
  quit: () => void;
}

const REPEATABLE = new Set<ShortcutAction>(['seekForward', 'seekBack', 'volumeUp', 'volumeDown']);

export function runShortcut(action: ShortcutAction, handlers: ShortcutHandlers): void {
  const { actions } = handlers;
  switch (action) {
    case 'togglePlay':
      actions.togglePlay();
      return;
    case 'next':
      actions.next();
      return;
    case 'previous':
      actions.previous();
      return;
    case 'seekForward':
      actions.seekRelative(1);
      return;
    case 'seekBack':
      actions.seekRelative(-1);
      return;
    case 'volumeUp':
      actions.stepVolume(1);
      return;
    case 'volumeDown':
      actions.stepVolume(-1);
      return;
    case 'mute':
      actions.toggleMute();
      return;
    case 'like':
      actions.toggleLike();
      return;
    case 'shuffle':
      actions.toggleShuffle();
      return;
    case 'repeat':
      actions.cycleRepeat();
      return;
    case 'focusSearch':
      handlers.focusSearch();
      return;
    case 'openSettings':
      handlers.openSettings();
      return;
    case 'escape':
      handlers.escape();
      return;
    case 'quit':
      handlers.quit();
      return;
  }
}

export function toPayload(event: KeyboardEvent): KeyPayload {
  return {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };
}

export function installShortcuts(handlers: ShortcutHandlers): (payload: KeyPayload) => void {
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) {
      return;
    }
    const target = event.target;
    const typing = isTypingTarget(target);
    const payload = toPayload(event);
    const action = resolveShortcut(payload, typing);
    if (action === null) {
      return;
    }
    if (action === 'escape' && typing && target instanceof HTMLElement) {
      const closed = handlers.escape();
      if (!closed) {
        target.blur();
      }
      event.preventDefault();
      return;
    }
    if (action === 'togglePlay' && isActivationTarget(target)) {
      return;
    }
    if (
      isSliderTarget(target) &&
      (action === 'seekForward' || action === 'seekBack' || action === 'volumeUp' || action === 'volumeDown')
    ) {
      return;
    }
    if (event.repeat && !REPEATABLE.has(action)) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    runShortcut(action, handlers);
  });
  return (payload: KeyPayload) => {
    const action = resolveShortcut(payload, false);
    if (action === null) {
      return;
    }
    runShortcut(action, handlers);
  };
}
