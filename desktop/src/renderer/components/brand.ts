import { h } from '../dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The five logo bars: x position, resting top and height (512 x 512 artboard). */
const BARS: readonly (readonly [number, number, number])[] = [
  [90, 196, 120],
  [162, 140, 232],
  [234, 96, 320],
  [306, 140, 232],
  [378, 196, 120],
];

/** The Musix logo with its bars gently bouncing like an equaliser. */
export function brandMark(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 512 512');
  svg.setAttribute('class', 'brand-mark');
  svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', '512');
  bg.setAttribute('height', '512');
  bg.setAttribute('rx', '112');
  bg.setAttribute('fill', '#4F46E5');
  svg.append(bg);
  BARS.forEach(([x, y, height], index) => {
    const bar = document.createElementNS(SVG_NS, 'rect');
    bar.setAttribute('x', String(x));
    bar.setAttribute('y', String(y));
    bar.setAttribute('width', '44');
    bar.setAttribute('height', String(height));
    bar.setAttribute('rx', '22');
    bar.setAttribute('fill', '#FFFFFF');
    bar.setAttribute('class', 'brand-bar');
    bar.style.setProperty('--bar-delay', `${index * -0.18}s`);
    svg.append(bar);
  });
  return svg;
}

/** "Musix" with the small "by amvprosox" line under it. */
export function brandText(): HTMLElement {
  return h('span', { className: 'brand-text' }, [
    h('span', { className: 'brand-name', text: 'Musix' }),
    h('span', { className: 'brand-by', text: 'by amvprosox' }),
  ]);
}
