import type { KeyPayload } from './types';

export type ShortcutAction =
  | 'togglePlay'
  | 'next'
  | 'previous'
  | 'seekForward'
  | 'seekBack'
  | 'volumeUp'
  | 'volumeDown'
  | 'mute'
  | 'like'
  | 'shuffle'
  | 'repeat'
  | 'focusSearch'
  | 'openSettings'
  | 'escape'
  | 'quit';

export const SHORTCUT_LIST: readonly { keys: string; description: string }[] = [
  { keys: 'Space', description: 'Play or pause' },
  { keys: 'Ctrl + Right', description: 'Next track' },
  { keys: 'Ctrl + Left', description: 'Previous track' },
  { keys: 'Right', description: 'Seek forward 10 seconds' },
  { keys: 'Left', description: 'Seek back 10 seconds' },
  { keys: 'Up', description: 'Volume up 5 percent' },
  { keys: 'Down', description: 'Volume down 5 percent' },
  { keys: 'M', description: 'Mute or unmute' },
  { keys: 'L', description: 'Like the current track' },
  { keys: 'S', description: 'Shuffle' },
  { keys: 'R', description: 'Cycle repeat mode' },
  { keys: 'Ctrl + K or /', description: 'Focus search' },
  { keys: 'Ctrl + ,', description: 'Open Settings' },
  { keys: 'Esc', description: 'Close drawers, sheets, and dialogs' },
  { keys: 'Ctrl + Q', description: 'Quit' },
];

export function resolveShortcut(event: KeyPayload, typing: boolean): ShortcutAction | null {
  const { key, ctrlKey, altKey, metaKey, shiftKey } = event;
  if (key === 'Escape') {
    return 'escape';
  }
  if (ctrlKey && !altKey && !metaKey && !shiftKey && (key === 'q' || key === 'Q')) {
    return 'quit';
  }
  if (typing) {
    return null;
  }
  if (altKey || metaKey) {
    return null;
  }
  if (ctrlKey) {
    if (shiftKey) {
      return null;
    }
    if (key === 'ArrowRight') {
      return 'next';
    }
    if (key === 'ArrowLeft') {
      return 'previous';
    }
    if (key === 'k' || key === 'K') {
      return 'focusSearch';
    }
    if (key === ',') {
      return 'openSettings';
    }
    return null;
  }
  if (key === '/') {
    return 'focusSearch';
  }
  if (shiftKey) {
    return null;
  }
  switch (key) {
    case ' ':
    case 'Spacebar':
      return 'togglePlay';
    case 'ArrowRight':
      return 'seekForward';
    case 'ArrowLeft':
      return 'seekBack';
    case 'ArrowUp':
      return 'volumeUp';
    case 'ArrowDown':
      return 'volumeDown';
    case 'm':
    case 'M':
      return 'mute';
    case 'l':
    case 'L':
      return 'like';
    case 's':
    case 'S':
      return 'shuffle';
    case 'r':
    case 'R':
      return 'repeat';
    default:
      return null;
  }
}

export function shouldInterceptInView(event: KeyPayload, typing: boolean): boolean {
  const action = resolveShortcut(event, typing);
  if (action === null) {
    return false;
  }
  return action !== 'escape';
}
