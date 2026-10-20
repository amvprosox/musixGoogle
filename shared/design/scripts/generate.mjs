import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const here = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(here, '..', '..');
const tokens = JSON.parse(readFileSync(path.join(here, 'tokens.json'), 'utf8'));
const check = process.argv.includes('--check');

const kebab = (name) => name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
const snake = (name) => name.replace(/([a-z])([A-Z0-9])/g, '$1_$2').toLowerCase();
const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value);
const rem = (px) => `${px / 16}rem`;

function cssBlock(selector, palette, extra = []) {
  const lines = Object.entries(palette).map(([name, value]) => `  --${kebab(name)}: ${value};`);
  return `${selector} {\n${[...lines, ...extra].join('\n')}\n}`;
}

function desktopCss() {
  const scale = tokens.type.scale.map((px) => `  --fs-${px}: ${rem(px)};`);
  const space = tokens.space.map((px) => `  --sp-${px}: ${px}px;`);
  const base = [
    `  --font-heading: '${tokens.font.heading}', '${tokens.font.body}', system-ui, sans-serif;`,
    `  --font-body: '${tokens.font.body}', system-ui, sans-serif;`,
    '',
    ...scale,
    '',
    `  --lh-body: ${tokens.type.lineHeightBody};`,
    `  --lh-heading: ${tokens.type.lineHeightHeading};`,
    '',
    ...space,
    '',
    `  --radius-control: ${tokens.radius.control}px;`,
    `  --radius-card: ${tokens.radius.card}px;`,
    `  --radius-pill: ${tokens.radius.pill}px;`,
    '',
    `  --control-h: ${tokens.size.controlHeight}px;`,
    `  --icon-btn: ${tokens.size.iconButton}px;`,
    '',
    `  --sidebar-expanded: ${tokens.size.sidebarExpanded}px;`,
    `  --sidebar-rail: ${tokens.size.sidebarRail}px;`,
    `  --topbar-h: ${tokens.size.topbar}px;`,
    `  --playerbar-h: ${tokens.size.playerbar}px;`,
    `  --compact-player-h: ${tokens.size.compactPlayer}px;`,
    `  --bottomnav-h: ${tokens.size.bottomNav}px;`,
    `  --queue-w: ${tokens.size.queue}px;`,
    `  --scrollbar-size: ${tokens.size.scrollbar}px;`,
    `  --edge-fade: ${tokens.size.edgeFade}px;`,
    '',
    `  --dur-hover: ${tokens.motion.hover}ms;`,
    `  --dur-drawer: ${tokens.motion.drawer}ms;`,
    `  --dur-scrollbar-in: ${tokens.motion.scrollbarFadeIn}ms;`,
    `  --dur-scrollbar-out: ${tokens.motion.scrollbarFadeOut}ms;`,
    '  --ease: ease;',
    '',
    `  --view-bg: ${tokens.viewBackground};`,
    '',
  ];
  const dark = Object.entries(tokens.color.dark).map(([name, value]) => `  --${kebab(name)}: ${value};`);
  return [
    `:root {\n${[...base, ...dark, '  color-scheme: dark;'].join('\n')}\n}`,
    cssBlock(":root[data-theme='dark']", tokens.color.dark, ['  color-scheme: dark;']),
    cssBlock(":root[data-theme='light']", tokens.color.light, ['  color-scheme: light;']),
    '@media (prefers-reduced-motion: reduce) {\n  :root {\n    --dur-hover: 0ms;\n    --dur-drawer: 0ms;\n    --dur-scrollbar-in: 0ms;\n    --dur-scrollbar-out: 0ms;\n  }\n}',
    '',
  ].join('\n\n');
}

function androidColors(palette) {
  const rows = Object.entries(palette)
    .filter(([, value]) => isHex(value))
    .map(([name, value]) => `    <color name="musix_${snake(name)}">${value.toUpperCase()}</color>`);
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${rows.join('\n')}\n</resources>\n`;
}

function androidDimens() {
  const rows = [
    ...tokens.type.scale.map((px) => `    <dimen name="musix_text_${px}">${px}sp</dimen>`),
    ...tokens.space.map((px) => `    <dimen name="musix_space_${px}">${px}dp</dimen>`),
    `    <dimen name="musix_radius_control">${tokens.radius.control}dp</dimen>`,
    `    <dimen name="musix_radius_card">${tokens.radius.card}dp</dimen>`,
    `    <dimen name="musix_control_height">${tokens.size.controlHeight}dp</dimen>`,
    `    <dimen name="musix_icon_button">${tokens.size.iconButton}dp</dimen>`,
  ];
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${rows.join('\n')}\n</resources>\n`;
}

function kotlinTokens() {
  const palette = (palette) =>
    Object.entries(palette)
      .filter(([, value]) => isHex(value))
      .map(([name, value]) => `        val ${name} = Color(0xFF${value.slice(1).toUpperCase()})`)
      .join('\n');
  return `package com.realmadhoney.musix.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object DesignTokens {
    const val FONT_HEADING = "${tokens.font.heading}"
    const val FONT_BODY = "${tokens.font.body}"
    const val LINE_HEIGHT_BODY = ${tokens.type.lineHeightBody}f
    const val LINE_HEIGHT_HEADING = ${tokens.type.lineHeightHeading}f
    const val MOTION_HOVER_MS = ${tokens.motion.hover}
    const val MOTION_DRAWER_MS = ${tokens.motion.drawer}
    const val MOTION_SCROLLBAR_IN_MS = ${tokens.motion.scrollbarFadeIn}
    const val MOTION_SCROLLBAR_OUT_MS = ${tokens.motion.scrollbarFadeOut}

${tokens.type.scale.map((px) => `    val Text${px} = ${px}.sp`).join('\n')}
${tokens.space.map((px) => `    val Space${px} = ${px}.dp`).join('\n')}
    val RadiusControl = ${tokens.radius.control}.dp
    val RadiusCard = ${tokens.radius.card}.dp
    val ControlHeight = ${tokens.size.controlHeight}.dp
    val IconButton = ${tokens.size.iconButton}.dp
    val MiniPlayerHeight = ${tokens.size.compactPlayer}.dp
    val BottomNavHeight = ${tokens.size.bottomNav}.dp
    val ScrollbarSize = ${tokens.size.scrollbar}.dp

    object Dark {
${palette(tokens.color.dark)}
    }

    object Light {
${palette(tokens.color.light)}
    }
}
`;
}

function swiftTokens() {
  const palette = (palette) =>
    Object.entries(palette)
      .filter(([, value]) => isHex(value))
      .map(([name, value]) => `        static let ${name}: UInt32 = 0x${value.slice(1).toUpperCase()}`)
      .join('\n');
  return `import Foundation

enum DesignTokens {
    static let fontHeading = "${tokens.font.heading}"
    static let fontBody = "${tokens.font.body}"
    static let lineHeightBody: Double = ${tokens.type.lineHeightBody}
    static let lineHeightHeading: Double = ${tokens.type.lineHeightHeading}
    static let minimumTextSize: Double = ${tokens.type.minimum}
${tokens.type.scale.map((px) => `    static let text${px}: Double = ${px}`).join('\n')}
${tokens.space.map((px) => `    static let space${px}: Double = ${px}`).join('\n')}
    static let radiusControl: Double = ${tokens.radius.control}
    static let radiusCard: Double = ${tokens.radius.card}
    static let controlHeight: Double = ${tokens.size.controlHeight}
    static let iconButton: Double = ${tokens.size.iconButton}
    static let miniPlayerHeight: Double = ${tokens.size.compactPlayer}
    static let scrollbarSize: Double = ${tokens.size.scrollbar}
    static let motionHover: Double = ${tokens.motion.hover / 1000}
    static let motionScrollbarIn: Double = ${tokens.motion.scrollbarFadeIn / 1000}
    static let motionScrollbarOut: Double = ${tokens.motion.scrollbarFadeOut / 1000}

    enum Dark {
${palette(tokens.color.dark)}
    }

    enum Light {
${palette(tokens.color.light)}
    }
}
`;
}

const outputs = [
  ['desktop/src/renderer/styles/tokens.css', desktopCss()],
  ['android/app/src/main/res/values/colors_tokens.xml', androidColors(tokens.color.light)],
  ['android/app/src/main/res/values-night/colors_tokens.xml', androidColors(tokens.color.dark)],
  ['android/app/src/main/res/values/dimens_tokens.xml', androidDimens()],
  ['android/app/src/main/java/com/realmadhoney/musix/ui/theme/DesignTokens.kt', kotlinTokens()],
  ['ios/Musix/Design/DesignTokens.swift', swiftTokens()],
];

const stale = [];
for (const [relative, content] of outputs) {
  const file = path.join(repo, relative);
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) {
      stale.push(relative);
    }
    continue;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
if (check) {
  if (stale.length > 0) {
    console.error(
      `Generated design files are out of date: ${stale.join(', ')}. Run npm run build -w @musix/design.`,
    );
    process.exit(1);
  }
  console.info('Generated design files are up to date');
} else {
  console.info(`Generated ${outputs.length} design token files`);
}
