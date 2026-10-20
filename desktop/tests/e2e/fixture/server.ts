import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const FIXTURE_DIR = path.join(process.env.MUSIX_ROOT ?? process.cwd(), 'tests', 'e2e', 'fixture');

function silentWav(seconds: number): Buffer {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + samples);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples, 40);
  buffer.fill(128, 44);
  return buffer;
}

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const html = readFileSync(path.join(FIXTURE_DIR, 'ytm.html'));
  const script = readFileSync(path.join(FIXTURE_DIR, 'ytm.js'));
  const track = silentWav(120);
  const ad = silentWav(30);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/fixture.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(script);
      return;
    }
    if (url.pathname === '/media/track.wav' || url.pathname === '/media/ad.wav') {
      const body = url.pathname.endsWith('ad.wav') ? ad : track;
      const range = req.headers.range;
      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        const start = match && match[1] ? Number.parseInt(match[1], 10) : 0;
        const end = match && match[2] ? Number.parseInt(match[2], 10) : body.length - 1;
        res.writeHead(206, {
          'content-type': 'audio/wav',
          'content-range': `bytes ${start}-${end}/${body.length}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
        });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'accept-ranges': 'bytes',
        'content-length': body.length,
      });
      res.end(body);
      return;
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname === '/slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      }, 2500);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
