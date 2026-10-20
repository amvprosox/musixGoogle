import * as esbuild from 'esbuild';
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const production = process.argv.includes('--production');
const require = createRequire(import.meta.url);
const packageDir = (name) => path.dirname(require.resolve(`${name}/package.json`));

const bridgeSourcePlugin = {
  name: 'bridge-source',
  setup(build) {
    build.onResolve({ filter: /^musix-bridge-source$/ }, () => ({
      path: path.resolve(root, '..', 'shared', 'bridge', 'dist', 'ytm-bridge.js'),
      namespace: 'bridge-source',
    }));
    build.onLoad({ filter: /.*/, namespace: 'bridge-source' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};

const externalizeThirdParty = {
  name: 'externalize-third-party',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@musix/') || args.path === 'musix-bridge-source') {
        return undefined;
      }
      return { path: args.path, external: true };
    });
  },
};

const shared = {
  bundle: true,
  sourcemap: production ? false : 'linked',
  minify: production,
  legalComments: 'none',
  logLevel: 'warning',
  absWorkingDir: root,
};

async function copyFonts() {
  const target = path.join(root, 'assets', 'fonts');
  await mkdir(target, { recursive: true });
  const wanted = [
    ['manrope', 'manrope-latin-400-normal.woff2'],
    ['manrope', 'manrope-latin-500-normal.woff2'],
    ['manrope', 'manrope-latin-600-normal.woff2'],
    ['sora', 'sora-latin-600-normal.woff2'],
    ['sora', 'sora-latin-700-normal.woff2'],
  ];
  for (const [family, file] of wanted) {
    await copyFile(path.join(packageDir(`@fontsource/${family}`), 'files', file), path.join(target, file));
  }
  await copyFile(
    path.join(packageDir('@fontsource/manrope'), 'LICENSE'),
    path.join(target, 'Manrope-OFL.txt'),
  );
  await copyFile(path.join(packageDir('@fontsource/sora'), 'LICENSE'), path.join(target, 'Sora-OFL.txt'));
}

async function build() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(path.join(dist, 'renderer'), { recursive: true });
  await copyFonts();

  await Promise.all([
    esbuild.build({
      ...shared,
      entryPoints: { index: 'src/main/index.ts' },
      outdir: 'dist/main',
      outExtension: { '.js': '.mjs' },
      platform: 'node',
      format: 'esm',
      target: 'node22',
      plugins: [externalizeThirdParty],
    }),
    esbuild.build({
      ...shared,
      entryPoints: {
        shell: 'src/preload/shell.ts',
        ytm: 'src/preload/ytm.ts',
        overlay: 'src/preload/overlay.ts',
      },
      outdir: 'dist/preload',
      outExtension: { '.js': '.cjs' },
      platform: 'browser',
      format: 'cjs',
      target: 'chrome130',
      external: ['electron'],
      plugins: [bridgeSourcePlugin],
    }),
    esbuild.build({
      ...shared,
      entryPoints: {
        main: 'src/renderer/main.ts',
        boot: 'src/renderer/boot.ts',
        overlay: 'src/renderer/overlay.ts',
      },
      outdir: 'dist/renderer',
      platform: 'browser',
      format: 'iife',
      target: 'chrome130',
    }),
    esbuild.build({
      ...shared,
      entryPoints: { app: 'src/renderer/styles/index.css', overlay: 'src/renderer/styles/overlay.css' },
      outdir: 'dist/renderer',
      loader: { '.woff2': 'file', '.woff': 'file' },
      assetNames: 'fonts/[name]-[hash]',
      target: 'chrome130',
    }),
  ]);

  for (const file of ['index.html', 'overlay.html']) {
    await copyFile(path.join(root, 'src', 'renderer', file), path.join(dist, 'renderer', file));
  }
  await copyFile(path.join(root, 'assets', 'icons', 'musix.svg'), path.join(dist, 'renderer', 'logo.svg'));

  const fonts = await readdir(path.join(dist, 'renderer', 'fonts'));
  const woff = fonts.filter((name) => name.endsWith('.woff'));
  for (const name of woff) {
    await rm(path.join(dist, 'renderer', 'fonts', name));
  }
  console.info(`Built ${production ? 'production' : 'development'} bundle into dist/`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
