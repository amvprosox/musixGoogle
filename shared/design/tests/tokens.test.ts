import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const tokens = JSON.parse(readFileSync(path.join(root, 'tokens.json'), 'utf8')) as {
  type: { scale: number[]; minimum: number };
  color: Record<'dark' | 'light', Record<string, string>>;
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const high = Math.max(luminance(a), luminance(b));
  const low = Math.min(luminance(a), luminance(b));
  return (high + 0.05) / (low + 0.05);
}

describe('design tokens', () => {
  it('never defines text below the minimum size', () => {
    expect(Math.min(...tokens.type.scale)).toBeGreaterThanOrEqual(tokens.type.minimum);
    expect(tokens.type.minimum).toBe(14);
  });

  it('defines the same color names for both themes', () => {
    expect(Object.keys(tokens.color.dark).sort()).toEqual(Object.keys(tokens.color.light).sort());
  });

  for (const theme of ['dark', 'light'] as const) {
    it(`${theme} text colors meet WCAG AA`, () => {
      const palette = tokens.color[theme];
      for (const [fg, bg] of [
        ['text', 'bg'],
        ['text', 'surface'],
        ['textMuted', 'surface'],
        ['accent', 'surface'],
        ['onAccent', 'accent'],
        ['danger', 'surface'],
      ] as const) {
        expect(
          contrast(palette[fg] ?? '#000000', palette[bg] ?? '#000000'),
          `${fg} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme} scrollbar thumb is visible against the surface`, () => {
      const palette = tokens.color[theme];
      expect(
        contrast(palette.scrollbarThumb ?? '#000000', palette.surface ?? '#000000'),
      ).toBeGreaterThanOrEqual(1.5);
      expect(
        contrast(palette.scrollbarThumbHover ?? '#000000', palette.surface ?? '#000000'),
      ).toBeGreaterThan(contrast(palette.scrollbarThumb ?? '#000000', palette.surface ?? '#000000'));
    });
  }

  it('generated platform files are up to date', () => {
    expect(() =>
      execFileSync(process.execPath, [path.join(root, 'scripts', 'generate.mjs'), '--check'], {
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
