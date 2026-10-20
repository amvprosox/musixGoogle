import { Resvg } from '@resvg/resvg-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'assets', 'icons', 'musix.svg');
const sizes = [16, 22, 24, 32, 48, 64, 128, 256, 512];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const svg = await readFile(source, 'utf8');
await mkdir(path.join(root, 'assets', 'icons'), { recursive: true });
const rendered = new Map();
for (const size of new Set([...sizes, ...icoSizes])) {
  rendered.set(size, Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()));
}
for (const size of sizes) {
  const png = rendered.get(size);
  if (png) {
    await writeFile(path.join(root, 'assets', 'icons', `${size}x${size}.png`), png);
  }
}
const icoImages = icoSizes.map((size) => ({ size, png: rendered.get(size) })).filter((image) => image.png);
await writeFile(path.join(root, 'assets', 'icons', 'musix.ico'), encodeIco(icoImages));
console.info(`Generated ${sizes.length} PNG sizes and a ${icoImages.length}-size ICO`);
