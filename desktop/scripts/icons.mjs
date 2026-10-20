import { Resvg } from '@resvg/resvg-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'assets', 'icons', 'musix.svg');
const sizes = [16, 22, 24, 32, 48, 64, 128, 256, 512];

const svg = await readFile(source, 'utf8');
await mkdir(path.join(root, 'assets', 'icons'), { recursive: true });
for (const size of sizes) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  await writeFile(path.join(root, 'assets', 'icons', `${size}x${size}.png`), png);
}
console.info(`Generated ${sizes.length} icon sizes`);
