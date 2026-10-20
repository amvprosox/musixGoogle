import { describe, expect, it } from 'vitest';
import { formatCount, formatTime, formatTimestamp, parseDuration } from '../../src/shared/format';

describe('formatTime', () => {
  it('formats minutes and seconds', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(214.9)).toBe('3:34');
  });

  it('formats hours', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3725)).toBe('1:02:05');
  });

  it('guards invalid values', () => {
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(-3)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('parseDuration', () => {
  it('parses clock strings', () => {
    expect(parseDuration('3:34')).toBe(214);
    expect(parseDuration('1:02:05')).toBe(3725);
    expect(parseDuration(' 45 ')).toBe(45);
  });

  it('rejects garbage', () => {
    expect(parseDuration('')).toBe(0);
    expect(parseDuration('abc')).toBe(0);
    expect(parseDuration('1:2:3:4')).toBe(0);
  });
});

describe('formatTimestamp', () => {
  const now = 1_700_000_000_000;
  it('describes relative times', () => {
    expect(formatTimestamp(null, now)).toBe('Never');
    expect(formatTimestamp(now - 10_000, now)).toBe('Just now');
    expect(formatTimestamp(now - 60_000, now)).toBe('1 minute ago');
    expect(formatTimestamp(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(formatTimestamp(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(formatTimestamp(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });
});

describe('formatCount', () => {
  it('formats with separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12345)).toBe('12,345');
    expect(formatCount(-1)).toBe('0');
  });
});
