import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(root, '..', '..');
const cacheDir = path.join(root, 'cache');
const dist = path.join(root, 'dist');
const offline = process.argv.includes('--offline');

const SOURCES = [
  ['easylist', 'https://easylist.to/easylist/easylist.txt'],
  ['easyprivacy', 'https://easylist.to/easylist/easyprivacy.txt'],
  ['ublock-filters', 'https://ublockorigin.github.io/uAssets/filters/filters.txt'],
  ['ublock-quick-fixes', 'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt'],
];

async function loadList(name, url) {
  const file = path.join(cacheDir, `${name}.txt`);
  if (!offline) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'Musix filter builder' } });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, text);
      return text;
    } catch (error) {
      if (!existsSync(file)) {
        throw new Error(`Could not download ${name} and no cached copy exists: ${error.message}`, {
          cause: error,
        });
      }
      console.warn(`Using cached ${name}: ${error.message}`);
    }
  }
  if (!existsSync(file)) {
    throw new Error(`No cached copy of ${name}; run without --offline first`);
  }
  return readFileSync(file, 'utf8');
}

const bundle = await esbuild.build({
  entryPoints: [path.join(root, 'src', 'pipeline.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'warning',
});
const pipelineFile = path.join(dist, 'pipeline.mjs');
mkdirSync(dist, { recursive: true });
writeFileSync(pipelineFile, bundle.outputFiles[0].text);
const pipeline = await import(pipelineFile);

const texts = [];
for (const [name, url] of SOURCES) {
  texts.push(await loadList(name, url));
}
const result = pipeline.buildAll(texts);

const scriptletBundle = await esbuild.build({
  entryPoints: [path.join(root, 'src', 'scriptlets-entry.ts')],
  bundle: true,
  format: 'iife',
  target: ['chrome83', 'safari15'],
  minify: true,
  write: false,
  define: { SCRIPTLET_CALLS: JSON.stringify(result.scriptlets) },
  logLevel: 'warning',
});

const outputs = {
  'hosts.bin': Buffer.from(result.hostsBin),
  'url-rules.txt': result.urlRules,
  'cosmetic.css': result.cosmeticCss,
  'scriptlets.js': scriptletBundle.outputFiles[0].text,
  'content-rules.json': JSON.stringify(result.webkitRules),
};
const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sources: SOURCES.map(([name, url]) => ({ name, url })),
  counts: result.counts,
  files: {},
};
for (const [name, content] of Object.entries(outputs)) {
  writeFileSync(path.join(dist, name), content);
  manifest.files[name] = createHash('sha256').update(content).digest('hex');
}
writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

const platforms = {
  'android/app/src/main/assets/adblock': [
    'hosts.bin',
    'url-rules.txt',
    'cosmetic.css',
    'scriptlets.js',
    'manifest.json',
  ],
  'ios/Musix/Resources/Adblock': ['content-rules.json', 'cosmetic.css', 'scriptlets.js', 'manifest.json'],
};
for (const [target, files] of Object.entries(platforms)) {
  const dir = path.join(repo, target);
  mkdirSync(dir, { recursive: true });
  for (const name of files) {
    writeFileSync(path.join(dir, name), readFileSync(path.join(dist, name)));
  }
}
console.info(
  `Built filters: ${result.counts.hosts} hosts, ${result.counts.urlRules} URL rules, ${result.counts.cosmetic} cosmetic selectors, ${result.counts.scriptlets} scriptlets, ${result.counts.webkitRules} WebKit rules`,
);
