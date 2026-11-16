import { describe, expect, it } from 'vitest';
import { OfflineSession, shuffled } from '../../src/shared/offline-session';

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('shuffled', () => {
  it('keeps every item exactly once', () => {
    const result = shuffled(ids, seeded(7));
    expect([...result].sort()).toEqual(ids);
  });
});

describe('OfflineSession in list order', () => {
  it('plays forward and stops at the end without repeat', () => {
    const session = new OfflineSession(ids, 'd', false);
    expect(session.current).toBe('d');
    expect(session.next(false)).toBe('e');
    expect(session.next(false)).toBe('f');
    expect(session.next(false)).toBeNull();
    expect(session.current).toBe('f');
  });

  it('wraps with repeat all', () => {
    const session = new OfflineSession(ids, 'f', false);
    expect(session.next(true)).toBe('a');
  });

  it('goes back to the song that actually played before a jump', () => {
    const session = new OfflineSession(ids, 'a', false);
    session.next(false);
    session.jumpTo('e');
    expect(session.previous(false)).toBe('b');
    expect(session.previous(false)).toBe('a');
    expect(session.previous(false)).toBeNull();
  });
});

describe('OfflineSession with shuffle', () => {
  it('plays every song once before repeating', () => {
    const session = new OfflineSession(ids, 'c', true, seeded(3));
    const played = [session.current];
    for (let i = 0; i < ids.length - 1; i += 1) {
      played.push(session.next(false));
    }
    expect([...played].sort()).toEqual(ids);
    expect(played[0]).toBe('c');
    expect(session.next(false)).toBeNull();
  });

  it('previous returns the songs in the reverse order they played', () => {
    const session = new OfflineSession(ids, 'a', true, seeded(11));
    const played = [session.current as string];
    for (let i = 0; i < 4; i += 1) {
      played.push(session.next(false) as string);
    }
    expect(session.previous(false)).toBe(played[3]);
    expect(session.previous(false)).toBe(played[2]);
    expect(session.next(false)).toBe(played[3]);
    expect(session.next(false)).toBe(played[4]);
  });

  it('reshuffles on repeat all without starting with the same song', () => {
    const session = new OfflineSession(['a', 'b'], 'a', true, () => 0);
    session.next(true);
    const last = session.current;
    expect(session.next(true)).not.toBe(last);
  });

  it('turning shuffle off continues in list order from the current song', () => {
    const session = new OfflineSession(ids, 'a', true, seeded(5));
    session.next(false);
    const cur = session.current as string;
    session.setShuffle(false);
    expect(session.current).toBe(cur);
    const expected = ids[ids.indexOf(cur) + 1] ?? null;
    expect(session.next(false)).toBe(expected);
  });

  it('jumping keeps unplayed songs queued', () => {
    const session = new OfflineSession(ids, 'a', true, seeded(9));
    const target = session.upcoming[3] as string;
    session.jumpTo(target);
    expect(session.current).toBe(target);
    expect(session.upcoming.length).toBe(ids.length - 2);
    expect(session.previous(false)).toBe('a');
  });

  it('syncs when downloads are removed or added', () => {
    const session = new OfflineSession(ids, 'a', true, seeded(2));
    session.next(false);
    const cur = session.current as string;
    session.syncQueue([...ids.filter((id) => id !== 'f'), 'g']);
    expect(session.current).toBe(cur);
    expect(session.ids).toContain('g');
    expect(session.upcoming).not.toContain('f');
    expect(session.upcoming).toContain('g');
  });
});
