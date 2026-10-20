import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesDir = path.resolve('src/renderer/styles');
const tokens = readFileSync(path.join(stylesDir, 'tokens.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`Missing ${selector}`);
  }
  const end = tokens.indexOf('}', start);
  const body = tokens.slice(start, end);
  const result: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) {
      result[name] = value.trim();
    }
  }
  return result;
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => Number.parseInt(clean.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-2'],
  ['text', 'surface-hover'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface'],
  ['text-muted', 'surface-2'],
  ['accent', 'surface'],
  ['accent', 'bg'],
  ['accent', 'accent-soft'],
  ['on-accent', 'accent'],
  ['on-accent', 'accent-hover'],
  ['danger', 'surface'],
  ['success', 'surface'],
  ['warning', 'surface'],
  ['bg', 'text'],
];

describe('design tokens', () => {
  for (const theme of ['dark', 'light'] as const) {
    const values = block(`:root[data-theme='${theme}']`);
    for (const [fg, bg] of TEXT_PAIRS) {
      it(`${theme}: ${fg} on ${bg} meets WCAG AA`, () => {
        const fgValue = values[fg];
        const bgValue = values[bg];
        expect(fgValue, fg).toMatch(/^#[0-9a-f]{6}$/i);
        expect(bgValue, bg).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrast(fgValue ?? '', bgValue ?? '')).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${theme}: defines every required token`, () => {
      for (const name of [
        'bg',
        'surface',
        'surface-2',
        'surface-hover',
        'border',
        'text',
        'text-muted',
        'accent',
        'accent-hover',
        'accent-soft',
        'success',
        'warning',
        'danger',
        'focus-ring',
      ]) {
        expect(values[name], name).toBeDefined();
      }
    });
  }

  it('never declares text smaller than 14px', () => {
    const files = readdirSync(stylesDir).filter((file) => file.endsWith('.css'));
    const scale = block(':root');
    const px = (value: string): number => {
      const token = /var\(--(fs-\d+)\)/.exec(value);
      if (token && token[1]) {
        return px(scale[token[1]] ?? '0');
      }
      const rem = /^([\d.]+)rem$/.exec(value);
      if (rem && rem[1]) {
        return Number.parseFloat(rem[1]) * 16;
      }
      const pixels = /^([\d.]+)px$/.exec(value);
      if (pixels && pixels[1]) {
        return Number.parseFloat(pixels[1]);
      }
      const clampMatch = /^clamp\(([^,]+),/.exec(value);
      if (clampMatch && clampMatch[1]) {
        return px(clampMatch[1].trim());
      }
      throw new Error(`Unrecognised font size ${value}`);
    };
    for (const file of files) {
      const css = readFileSync(path.join(stylesDir, file), 'utf8');
      for (const match of css.matchAll(/font-size:\s*([^;]+);/g)) {
        const value = (match[1] ?? '').trim();
        expect(px(value), `${file}: ${value}`).toBeGreaterThanOrEqual(14);
      }
    }
  });

  it('uses Sora for headings and Manrope for body text', () => {
    const base = readFileSync(path.join(stylesDir, 'base.css'), 'utf8');
    expect(tokens).toContain("--font-heading: 'Sora'");
    expect(tokens).toContain("--font-body: 'Manrope'");
    expect(base).toMatch(/h6 \{\s*font-family: var\(--font-heading\)/);
    expect(base).toMatch(/body \{[^}]*font-family: var\(--font-body\)/);
  });
});
