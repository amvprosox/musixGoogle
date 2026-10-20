import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const { icons } = require('lucide');

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const check = process.argv.includes('--check');
const tokens = JSON.parse(readFileSync(path.resolve(here, '..', 'tokens.json'), 'utf8'));

const ICONS = {
  play: 'Play',
  pause: 'Pause',
  skip_back: 'SkipBack',
  skip_forward: 'SkipForward',
  heart: 'Heart',
  shuffle: 'Shuffle',
  repeat: 'Repeat',
  repeat_one: 'Repeat1',
  home: 'House',
  library: 'Library',
  list_music: 'ListMusic',
  history: 'History',
  search: 'Search',
  music: 'Music',
  log_in: 'LogIn',
  log_out: 'LogOut',
  wifi_off: 'WifiOff',
  alert: 'CircleAlert',
  settings: 'Settings',
  close: 'X',
  back: 'ChevronLeft',
  forward: 'ChevronRight',
  collapse: 'ChevronDown',
  refresh: 'RefreshCw',
  album: 'Disc3',
  artist: 'MicVocal',
  queue: 'ListPlus',
  user: 'User',
  trash: 'Trash2',
  car: 'Car',
  thumbs_down: 'ThumbsDown',
};

const FILLED = new Set(['heart', 'play', 'pause']);

const IOS_ONLY = new Set(['play', 'pause', 'thumbs_down']);

const LOGO_BARS = [
  [90, 196, 44, 120],
  [162, 140, 44, 232],
  [234, 96, 44, 320],
  [306, 140, 44, 232],
  [378, 196, 44, 120],
];

const num = (value) => String(Math.round(value * 1000) / 1000);

function attr(attrs, key, fallback = 0) {
  const raw = attrs[key];
  if (raw === undefined) {
    return fallback;
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Bad ${key} value ${raw}`);
  }
  return value;
}

function roundedRect(x, y, w, h, rxIn, ryIn) {
  const rx = Math.min(rxIn, w / 2);
  const ry = Math.min(ryIn, h / 2);
  if (rx <= 0 || ry <= 0) {
    return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}z`;
  }
  return [
    `M${num(x + rx)} ${num(y)}`,
    `h${num(w - 2 * rx)}`,
    `a${num(rx)} ${num(ry)} 0 0 1 ${num(rx)} ${num(ry)}`,
    `v${num(h - 2 * ry)}`,
    `a${num(rx)} ${num(ry)} 0 0 1 ${num(-rx)} ${num(ry)}`,
    `h${num(-(w - 2 * rx))}`,
    `a${num(rx)} ${num(ry)} 0 0 1 ${num(-rx)} ${num(-ry)}`,
    `v${num(-(h - 2 * ry))}`,
    `a${num(rx)} ${num(ry)} 0 0 1 ${num(rx)} ${num(-ry)}`,
    'z',
  ].join('');
}

function toPath([tag, attrs]) {
  switch (tag) {
    case 'path':
      return attrs.d;
    case 'circle': {
      const cx = attr(attrs, 'cx');
      const cy = attr(attrs, 'cy');
      const r = attr(attrs, 'r');
      return `M${num(cx - r)} ${num(cy)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0`;
    }
    case 'ellipse': {
      const cx = attr(attrs, 'cx');
      const cy = attr(attrs, 'cy');
      const rx = attr(attrs, 'rx');
      const ry = attr(attrs, 'ry');
      return `M${num(cx - rx)} ${num(cy)}a${num(rx)} ${num(ry)} 0 1 0 ${num(2 * rx)} 0a${num(rx)} ${num(ry)} 0 1 0 ${num(-2 * rx)} 0`;
    }
    case 'rect': {
      const rx = attr(attrs, 'rx', attr(attrs, 'ry'));
      const ry = attr(attrs, 'ry', rx);
      return roundedRect(
        attr(attrs, 'x'),
        attr(attrs, 'y'),
        attr(attrs, 'width'),
        attr(attrs, 'height'),
        rx,
        ry,
      );
    }
    case 'line':
      return `M${num(attr(attrs, 'x1'))} ${num(attr(attrs, 'y1'))}L${num(attr(attrs, 'x2'))} ${num(attr(attrs, 'y2'))}`;
    case 'polyline':
    case 'polygon': {
      const points = String(attrs.points)
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (points.length < 4 || points.length % 2 !== 0 || points.some((p) => !Number.isFinite(p))) {
        throw new Error(`Bad points ${attrs.points}`);
      }
      const segments = [];
      for (let i = 0; i < points.length; i += 2) {
        segments.push(`${i === 0 ? 'M' : 'L'}${num(points[i])} ${num(points[i + 1])}`);
      }
      return segments.join('') + (tag === 'polygon' ? 'z' : '');
    }
    default:
      throw new Error(`Unsupported lucide element ${tag}`);
  }
}

function vectorDrawable(paths, { filled }) {
  const body = paths
    .map(
      (d) =>
        `    <path\n        android:pathData="${d}"\n        android:fillColor="${filled ? '#FFFFFFFF' : '#00000000'}"\n        android:strokeColor="#FFFFFFFF"\n        android:strokeWidth="2"\n        android:strokeLineCap="round"\n        android:strokeLineJoin="round" />`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="24dp"\n    android:height="24dp"\n    android:viewportWidth="24"\n    android:viewportHeight="24">\n${body}\n</vector>\n`;
}

function svg(paths, { filled }) {
  const body = paths
    .map(
      (d) =>
        `  <path d="${d}" fill="${filled ? '#000000' : 'none'}" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">\n${body}\n</svg>\n`;
}

function logoBars(scale, offsetX, offsetY) {
  return LOGO_BARS.map(([x, y, w, h]) =>
    roundedRect(
      (x - 256) * scale + offsetX,
      (y - 256) * scale + offsetY,
      w * scale,
      h * scale,
      (w / 2) * scale,
      (w / 2) * scale,
    ),
  );
}

function filledVector(paths, size, viewport, color) {
  const body = paths
    .map((d) => `    <path\n        android:pathData="${d}"\n        android:fillColor="${color}" />`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="${size}dp"\n    android:height="${size}dp"\n    android:viewportWidth="${viewport}"\n    android:viewportHeight="${viewport}">\n${body}\n</vector>\n`;
}

const outputs = new Map();
const androidDrawable = path.join(repo, 'android', 'app', 'src', 'main', 'res', 'drawable');
const iosIcons = path.join(repo, 'ios', 'Musix', 'Resources', 'Assets.xcassets', 'Icons');

for (const [name, lucideName] of Object.entries(ICONS)) {
  const node = icons[lucideName];
  if (!Array.isArray(node)) {
    throw new Error(`Lucide icon ${lucideName} is missing`);
  }
  const paths = node.map(toPath);
  if (!IOS_ONLY.has(name)) {
    outputs.set(path.join(androidDrawable, `ic_${name}.xml`), vectorDrawable(paths, { filled: false }));
  }
  outputs.set(path.join(iosIcons, `${name}.imageset`, `${name}.svg`), svg(paths, { filled: false }));
  outputs.set(
    path.join(iosIcons, `${name}.imageset`, 'Contents.json'),
    `${JSON.stringify(
      {
        images: [{ filename: `${name}.svg`, idiom: 'universal' }],
        info: { author: 'xcode', version: 1 },
        properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
      },
      null,
      2,
    )}\n`,
  );
  if (FILLED.has(name)) {
    outputs.set(path.join(androidDrawable, `ic_${name}_filled.xml`), vectorDrawable(paths, { filled: true }));
    outputs.set(
      path.join(iosIcons, `${name}_filled.imageset`, `${name}_filled.svg`),
      svg(paths, { filled: true }),
    );
    outputs.set(
      path.join(iosIcons, `${name}_filled.imageset`, 'Contents.json'),
      `${JSON.stringify(
        {
          images: [{ filename: `${name}_filled.svg`, idiom: 'universal' }],
          info: { author: 'xcode', version: 1 },
          properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' },
        },
        null,
        2,
      )}\n`,
    );
  }
}

outputs.set(
  path.join(iosIcons, 'Contents.json'),
  `${JSON.stringify({ info: { author: 'xcode', version: 1 }, properties: { 'provides-namespace': false } }, null, 2)}\n`,
);

const brand = tokens.color.light.accent;
outputs.set(
  path.join(androidDrawable, 'ic_launcher_foreground.xml'),
  filledVector(logoBars(56 / 332, 54, 54), 108, 108, '#FFFFFFFF'),
);
outputs.set(
  path.join(androidDrawable, 'ic_launcher_monochrome.xml'),
  filledVector(logoBars(56 / 332, 54, 54), 108, 108, '#FFFFFFFF'),
);
outputs.set(
  path.join(androidDrawable, 'ic_stat_musix.xml'),
  filledVector(logoBars(20 / 332, 12, 12), 24, 24, '#FFFFFFFF'),
);
outputs.set(
  path.join(repo, 'android', 'app', 'src', 'main', 'res', 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${brand.toUpperCase()}</color>\n</resources>\n`,
);
outputs.set(
  path.join(repo, 'ios', 'Musix', 'Resources', 'Logo.svg'),
  readFileSync(path.join(repo, 'desktop', 'assets', 'icons', 'musix.svg'), 'utf8'),
);

const binaries = new Map([
  [
    path.join(repo, 'android', 'app', 'src', 'main', 'res', 'font', 'sora.ttf'),
    path.resolve(here, '..', 'fonts', 'Sora.ttf'),
  ],
  [
    path.join(repo, 'android', 'app', 'src', 'main', 'res', 'font', 'manrope.ttf'),
    path.resolve(here, '..', 'fonts', 'Manrope.ttf'),
  ],
  [
    path.join(repo, 'ios', 'Musix', 'Resources', 'Fonts', 'Sora.ttf'),
    path.resolve(here, '..', 'fonts', 'Sora.ttf'),
  ],
  [
    path.join(repo, 'ios', 'Musix', 'Resources', 'Fonts', 'Manrope.ttf'),
    path.resolve(here, '..', 'fonts', 'Manrope.ttf'),
  ],
]);

const assetCatalog = path.join(repo, 'ios', 'Musix', 'Resources', 'Assets.xcassets');
outputs.set(
  path.join(assetCatalog, 'Contents.json'),
  `${JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2)}\n`,
);
outputs.set(
  path.join(assetCatalog, 'AppIcon.appiconset', 'Contents.json'),
  `${JSON.stringify(
    {
      images: [{ filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
      info: { author: 'xcode', version: 1 },
    },
    null,
    2,
  )}\n`,
);
const squareLogo = readFileSync(path.join(repo, 'desktop', 'assets', 'icons', 'musix.svg'), 'utf8').replace(
  'rx="112"',
  'rx="0"',
);
const appIconPng = new Resvg(squareLogo, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();

let stale = 0;
const generatedBinaries = [
  [path.join(assetCatalog, 'AppIcon.appiconset', 'AppIcon.png'), Buffer.from(appIconPng)],
];
for (const [file, bytes] of generatedBinaries) {
  if (existsSync(file) && readFileSync(file).equals(bytes)) {
    continue;
  }
  if (check) {
    console.error(`Out of date: ${path.relative(repo, file)}`);
    stale += 1;
    continue;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}
for (const [file, source] of binaries) {
  const bytes = readFileSync(source);
  if (existsSync(file) && readFileSync(file).equals(bytes)) {
    continue;
  }
  if (check) {
    console.error(`Out of date: ${path.relative(repo, file)}`);
    stale += 1;
    continue;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}
for (const [file, content] of outputs) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === content) {
    continue;
  }
  if (check) {
    console.error(`Out of date: ${path.relative(repo, file)}`);
    stale += 1;
    continue;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

if (!check) {
  const generatedDrawables = new Set(
    [...outputs.keys()].filter((file) => file.startsWith(androidDrawable)).map((file) => path.basename(file)),
  );
  for (const entry of existsSync(androidDrawable) ? readdirSync(androidDrawable) : []) {
    if (entry.startsWith('ic_') && entry.endsWith('.xml') && !generatedDrawables.has(entry)) {
      rmSync(path.join(androidDrawable, entry));
    }
  }
  const expected = new Set(
    [...outputs.keys()].filter((file) => file.startsWith(iosIcons)).map((file) => path.dirname(file)),
  );
  if (existsSync(iosIcons)) {
    for (const entry of readdirSync(iosIcons)) {
      const dir = path.join(iosIcons, entry);
      if (entry.endsWith('.imageset') && !expected.has(dir)) {
        rmSync(dir, { recursive: true });
      }
    }
  }
}

if (stale > 0) {
  console.error(`${stale} icon files are out of date. Run npm run icons -w @musix/design.`);
  process.exit(1);
}
console.info(
  `Icons: ${Object.keys(ICONS).length} lucide icons for Android and iOS, plus launcher and notification icons`,
);
