import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..', '..');
mkdirSync(path.join(root, 'dist'), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'src', 'entry.ts')],
  outfile: path.join(root, 'dist', 'ytm-bridge.js'),
  bundle: true,
  format: 'iife',
  target: ['chrome83', 'safari15'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});
const source = readFileSync(path.join(root, 'dist', 'ytm-bridge.js'), 'utf8');
const targets = ['android/app/src/main/assets/web/ytm-bridge.js', 'ios/Musix/Resources/Web/ytm-bridge.js'];
for (const target of targets) {
  const file = path.join(repo, target);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
}
console.info(
  `Built dist/ytm-bridge.js (${source.length} bytes) and copied it to ${targets.length} platform bundles`,
);
