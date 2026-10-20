import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'MPL-2.0',
  'OFL-1.1',
  'BlueOak-1.0.0',
  'Python-2.0',
  'CC0-1.0',
]);
const EXCLUDED = new Set(['usocket', 'node-gyp']);
const NOT_SHIPPED = new Set(['electron']);
const VERIFIED = {
  jsbi: 'Apache-2.0',
  'map-stream': 'MIT',
  'pause-stream': 'MIT OR Apache-2.0',
  '@nornagon/put': 'MIT',
};
const BUNDLED_DEV = ['electron', 'lucide', '@fontsource/sora', '@fontsource/manrope'];

function readLicense(pkgDir) {
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  let license = pkg.license;
  if (typeof license === 'object' && license !== null) {
    license = license.type;
  }
  if (!license && Array.isArray(pkg.licenses)) {
    license = pkg.licenses.map((entry) => entry.type).join(' OR ');
  }
  const verified = VERIFIED[pkg.name];
  const declared = String(license ?? 'UNKNOWN');
  return {
    name: pkg.name,
    version: pkg.version,
    license: verified && !isAllowed(declared) ? `${verified} (from the package LICENSE file)` : declared,
    spdx: verified && !isAllowed(declared) ? verified : declared,
  };
}

function isAllowed(expression) {
  const cleaned = expression.replace(/[()]/g, '');
  if (cleaned.includes(' OR ')) {
    return cleaned.split(' OR ').some((part) => ALLOWED.has(part.trim()));
  }
  if (cleaned.includes(' AND ')) {
    return cleaned.split(' AND ').every((part) => ALLOWED.has(part.trim()));
  }
  return ALLOWED.has(cleaned.trim());
}

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const found = new Map();
function walk(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (EXCLUDED.has(name) || !child.path || !existsSync(child.path)) {
      continue;
    }
    const info = readLicense(child.path);
    found.set(`${info.name}@${info.version}`, info);
    if (!NOT_SHIPPED.has(name)) {
      walk(child);
    }
  }
}
walk(tree);
for (const name of BUNDLED_DEV) {
  const info = readLicense(path.dirname(createRequire(import.meta.url).resolve(`${name}/package.json`)));
  found.set(`${info.name}@${info.version}`, info);
}

const rows = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
const rejected = rows.filter((row) => !isAllowed(row.spdx));
const lines = [
  '# Third-party licenses',
  '',
  'Musix is MIT licensed. It ships or bundles the following third-party packages. Every license is in the',
  'allowed set: MIT, MPL-2.0, Apache-2.0, BSD, ISC, or OFL. Electron additionally ships Chromium, whose',
  'component licenses are listed in `LICENSES.chromium.html` next to the installed binary.',
  '',
  'The fonts Sora and Manrope are distributed under the SIL Open Font License 1.1; copies of the license are in',
  '`assets/fonts`. Icons come from Lucide (ISC). The ad blocker engine is Ghostery adblocker (MPL-2.0); its',
  'source is available at https://github.com/ghostery/adblocker.',
  '',
  'The native `usocket` helper and its `node-gyp` build tooling are optional dependencies of `dbus-next`; they',
  'are excluded from packaged builds and are not listed here.',
  '',
  '| Package | Version | License |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.license} |`),
  '',
];
writeFileSync(path.join(root, 'THIRD_PARTY_LICENSES.md'), lines.join('\n'));
console.info(`Listed ${rows.length} packages in THIRD_PARTY_LICENSES.md`);
if (rejected.length > 0) {
  console.error('Packages with licenses outside the allowed set:');
  for (const row of rejected) {
    console.error(`  ${row.name}@${row.version}: ${row.license}`);
  }
  process.exit(1);
}
