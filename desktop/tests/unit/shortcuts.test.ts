import { describe, expect, it } from 'vitest';
import { resolveShortcut, shouldInterceptInView } from '../../src/shared/shortcuts';
import type { KeyPayload } from '../../src/shared/types';

function key(k: string, mods: Partial<KeyPayload> = {}): KeyPayload {
  return { key: k, code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods };
}

describe('resolveShortcut', () => {
  it('maps the documented keys', () => {
    expect(resolveShortcut(key(' '), false)).toBe('togglePlay');
    expect(resolveShortcut(key('ArrowRight', { ctrlKey: true }), false)).toBe('next');
    expect(resolveShortcut(key('ArrowLeft', { ctrlKey: true }), false)).toBe('previous');
    expect(resolveShortcut(key('ArrowRight'), false)).toBe('seekForward');
    expect(resolveShortcut(key('ArrowLeft'), false)).toBe('seekBack');
    expect(resolveShortcut(key('ArrowUp'), false)).toBe('volumeUp');
    expect(resolveShortcut(key('ArrowDown'), false)).toBe('volumeDown');
    expect(resolveShortcut(key('m'), false)).toBe('mute');
    expect(resolveShortcut(key('L'), false)).toBe('like');
    expect(resolveShortcut(key('s'), false)).toBe('shuffle');
    expect(resolveShortcut(key('r'), false)).toBe('repeat');
    expect(resolveShortcut(key('k', { ctrlKey: true }), false)).toBe('focusSearch');
    expect(resolveShortcut(key('/'), false)).toBe('focusSearch');
    expect(resolveShortcut(key(',', { ctrlKey: true }), false)).toBe('openSettings');
    expect(resolveShortcut(key('Escape'), false)).toBe('escape');
    expect(resolveShortcut(key('q', { ctrlKey: true }), false)).toBe('quit');
  });

  it('ignores shortcuts while typing except escape and quit', () => {
    expect(resolveShortcut(key(' '), true)).toBeNull();
    expect(resolveShortcut(key('m'), true)).toBeNull();
    expect(resolveShortcut(key('k', { ctrlKey: true }), true)).toBeNull();
    expect(resolveShortcut(key('Escape'), true)).toBe('escape');
    expect(resolveShortcut(key('q', { ctrlKey: true }), true)).toBe('quit');
  });

  it('ignores unrelated modifier combinations', () => {
    expect(resolveShortcut(key('m', { altKey: true }), false)).toBeNull();
    expect(resolveShortcut(key('s', { shiftKey: true }), false)).toBeNull();
    expect(resolveShortcut(key('r', { ctrlKey: true }), false)).toBeNull();
    expect(resolveShortcut(key('x'), false)).toBeNull();
  });

  it('decides which keys the YouTube Music view intercepts', () => {
    expect(shouldInterceptInView(key(' '), false)).toBe(true);
    expect(shouldInterceptInView(key(' '), true)).toBe(false);
    expect(shouldInterceptInView(key('Escape'), false)).toBe(false);
    expect(shouldInterceptInView(key('a'), false)).toBe(false);
  });
});
