import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

export const VOICE_PACK_NAME = 'musix-voice-pack-1';
export const VOICE_PACK_URL = `https://github.com/amvprosox/musixGoogle/releases/download/voice-pack-1/${VOICE_PACK_NAME}.zip`;
export const VOICE_PACK_SHA256 = '617b4b97ee0bb45d7f9ca4c82ef8eccfc58e74d2e77313986c4ce78a1f7d7792';
const VOICE_PACK_BYTES = 55_653_713;

export const PACK_FILES = [
  'manifest.json',
  'kws/encoder.int8.onnx',
  'kws/decoder.int8.onnx',
  'kws/joiner.int8.onnx',
  'kws/tokens.txt',
  'kws/keywords.txt',
  'vad/silero_vad.onnx',
  'asr/encoder.int8.onnx',
  'asr/decoder.int8.onnx',
  'asr/joiner.int8.onnx',
  'asr/tokens.txt',
  'speaker/campplus_en.onnx',
] as const;

export function packDir(voiceDir: string): string {
  return path.join(voiceDir, VOICE_PACK_NAME);
}

export function isPackInstalled(voiceDir: string): boolean {
  const dir = packDir(voiceDir);
  return PACK_FILES.every((file) => existsSync(path.join(dir, file)));
}

export async function installPack(
  voiceDir: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(VOICE_PACK_URL, signal ? { signal } : {});
  if (!response.ok || !response.body) {
    throw new Error(`Voice pack download failed (HTTP ${response.status})`);
  }
  const total = Number(response.headers.get('content-length')) || VOICE_PACK_BYTES;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.byteLength;
    onProgress(Math.min(0.99, received / total));
  }
  const zip = Buffer.concat(chunks);
  const digest = createHash('sha256').update(zip).digest('hex');
  if (digest !== VOICE_PACK_SHA256) {
    throw new Error('Voice pack checksum did not match. Try again.');
  }
  const files = unzipSync(new Uint8Array(zip));
  const target = packDir(voiceDir);
  const staging = `${target}.partial`;
  await fsp.rm(staging, { recursive: true, force: true });
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || (data.byteLength === 0 && !name.includes('.'))) {
      continue;
    }
    const relative = name.startsWith(`${VOICE_PACK_NAME}/`) ? name.slice(VOICE_PACK_NAME.length + 1) : name;
    if (relative === '' || relative.includes('..')) {
      continue;
    }
    const file = path.join(staging, relative);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, data);
  }
  for (const file of PACK_FILES) {
    if (!existsSync(path.join(staging, file))) {
      throw new Error(`Voice pack is missing ${file}`);
    }
  }
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.rename(staging, target);
  onProgress(1);
}

export type WhisperVariant = 'en' | 'multi' | 'small';

const WHISPER_PACKS: Readonly<
  Record<WhisperVariant, { name: string; tag: string; sha: string; bytes: number }>
> = {
  en: {
    name: 'musix-whisper-pack-1',
    tag: 'voice-whisper-1',
    sha: '9f2891a4c61723e407a3f14be5794ec9046ed00238c02987202168a4c875f1bc',
    bytes: 94_129_407,
  },
  multi: {
    name: 'musix-whisper-multi-1',
    tag: 'voice-whisper-multi-1',
    sha: '8c72553ac09e849e9feb113a793c55496f1831e4a586433935783641b664a9f5',
    bytes: 93_529_364,
  },
  small: {
    name: 'musix-whisper-small-1',
    tag: 'voice-whisper-small-1',
    sha: 'aab3f9d774a56545ff36f75fcc1ffd685f82dac3991b6aa5c32dbd856df3c715',
    bytes: 231_060_160,
  },
};
const WHISPER_FILES = ['manifest.json', 'encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'] as const;

export function whisperDir(voiceDir: string, variant: WhisperVariant = 'en'): string {
  return path.join(voiceDir, WHISPER_PACKS[variant].name);
}

export function isWhisperInstalled(voiceDir: string, variant: WhisperVariant = 'en'): boolean {
  const dir = whisperDir(voiceDir, variant);
  return WHISPER_FILES.every((file) => existsSync(path.join(dir, file)));
}

export async function installWhisperPack(
  voiceDir: string,
  onProgress: (fraction: number) => void,
  variant: WhisperVariant = 'en',
): Promise<void> {
  const pack = WHISPER_PACKS[variant];
  const url = `https://github.com/amvprosox/musixGoogle/releases/download/${pack.tag}/${pack.name}.zip`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Whisper download failed (HTTP ${response.status})`);
  }
  const total = Number(response.headers.get('content-length')) || pack.bytes;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.byteLength;
    onProgress(Math.min(0.99, received / total));
  }
  const zip = Buffer.concat(chunks);
  if (createHash('sha256').update(zip).digest('hex') !== pack.sha) {
    throw new Error('Whisper download checksum did not match.');
  }
  const files = unzipSync(new Uint8Array(zip));
  const target = whisperDir(voiceDir, variant);
  const staging = `${target}.partial`;
  await fsp.rm(staging, { recursive: true, force: true });
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) {
      continue;
    }
    const relative = name.startsWith(`${pack.name}/`) ? name.slice(pack.name.length + 1) : name;
    if (relative === '' || relative.includes('..')) {
      continue;
    }
    const file = path.join(staging, relative);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, data);
  }
  for (const file of WHISPER_FILES) {
    if (!existsSync(path.join(staging, file))) {
      throw new Error(`Whisper download is missing ${file}`);
    }
  }
  await fsp.rm(target, { recursive: true, force: true });
  await fsp.rename(staging, target);
  onProgress(1);
}
