import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..');
const check = process.argv.includes('--check');
const target = path.join(repo, 'ios', 'Musix', 'Resources', 'Web', 'ytm-skin.css');

const built = await esbuild.build({
  entryPoints: [path.join(root, 'src', 'shared', 'ytm-css.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
});
const output = built.outputFiles[0];
if (!output) {
  throw new Error('ytm-css did not build');
}
const module = await import(`data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`);
const shared = String(module.YTM_INJECTED_CSS)
  .split('\n')
  .filter((line) => !line.startsWith('@font-face'))
  .join('\n');

const fonts = [
  { family: 'Manrope', file: 'Manrope.ttf' },
  { family: 'Sora', file: 'Sora.ttf' },
]
  .map(({ family, file }) => {
    const data = readFileSync(path.join(repo, 'shared', 'design', 'fonts', file)).toString('base64');
    return `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:200 800;src:url(data:font/ttf;base64,${data}) format('truetype');}`;
  })
  .join('\n');

const touch = `
html {
  -webkit-text-size-adjust: 100% !important;
  background: #000 !important;
}
ytmusic-app, ytmusic-app * {
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
ytmusic-app-layout > #content {
  padding-bottom: 16px !important;
}
`;

const css = `${fonts}\n${shared}\n${touch}`;
if (check) {
  const current = readFileSync(target, 'utf8');
  if (current !== css) {
    console.error('ios/Musix/Resources/Web/ytm-skin.css is out of date. Run npm run ios-skin -w musix.');
    process.exit(1);
  }
} else {
  writeFileSync(target, css);
  console.info(`Wrote ${path.relative(repo, target)} (${css.length} bytes)`);
}
