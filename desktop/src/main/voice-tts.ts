import { createHash } from 'node:crypto';
import { existsSync, promises as fsp, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { logWarn } from './log';

export const TTS_PACK_NAME = 'musix-tts-pack-1';
const TTS_PACK_URL = `https://github.com/amvprosox/musixGoogle/releases/download/voice-tts-1/${TTS_PACK_NAME}.zip`;
const TTS_PACK_SHA256 = 'e1e16d7b3b8be918af9956fb563c882872d12d790a2e6f0e1be67dddff6cd48c';
const TTS_PACK_BYTES = 116_486_475;
const TTS_FILES = [
  'manifest.json',
  'model.int8.onnx',
  'voices.bin',
  'tokens.txt',
  'lexicon-us-en.txt',
] as const;
const SPEAKER = 3;
const MAX_CHARS = 240;

export interface SpeechAudio {
  samples: Float32Array;
  sampleRate: number;
}

interface TtsEngine {
  generateAsync(request: {
    text: string;
    sid: number;
    speed: number;
    enableExternalBuffer: boolean;
  }): Promise<{ samples: Float32Array; sampleRate: number }>;
}

interface TtsModule {
  OfflineTts: { createAsync(config: unknown): Promise<TtsEngine> };
}

function speechWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter((word) => word !== '');
}

export class NaturalVoice {
  private engine: TtsEngine | null = null;
  private words: Set<string> | null = null;
  private loading: Promise<boolean> | null = null;

  constructor(private readonly voiceDir: string) {}

  private get dir(): string {
    return path.join(this.voiceDir, TTS_PACK_NAME);
  }

  installed(): boolean {
    return TTS_FILES.every((file) => existsSync(path.join(this.dir, file)));
  }

  async install(onProgress: (fraction: number) => void): Promise<void> {
    const response = await fetch(TTS_PACK_URL);
    if (!response.ok || !response.body) {
      throw new Error(`Voice download failed (HTTP ${response.status})`);
    }
    const total = Number(response.headers.get('content-length')) || TTS_PACK_BYTES;
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
    if (createHash('sha256').update(zip).digest('hex') !== TTS_PACK_SHA256) {
      throw new Error('Voice download checksum did not match. Try again.');
    }
    const files = unzipSync(new Uint8Array(zip));
    const staging = `${this.dir}.partial`;
    await fsp.rm(staging, { recursive: true, force: true });
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/')) {
        continue;
      }
      const relative = name.startsWith(`${TTS_PACK_NAME}/`) ? name.slice(TTS_PACK_NAME.length + 1) : name;
      if (relative === '' || relative.includes('..')) {
        continue;
      }
      const file = path.join(staging, relative);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, data);
    }
    for (const file of TTS_FILES) {
      if (!existsSync(path.join(staging, file))) {
        throw new Error(`Voice download is missing ${file}`);
      }
    }
    await fsp.rm(this.dir, { recursive: true, force: true });
    await fsp.rename(staging, this.dir);
    this.engine = null;
    this.words = null;
    this.loading = null;
    onProgress(1);
  }

  private load(): Promise<boolean> {
    if (this.engine) {
      return Promise.resolve(true);
    }
    if (!this.installed()) {
      return Promise.resolve(false);
    }
    this.loading ??= (async () => {
      try {
        const lexicon = path.join(this.dir, 'lexicon-us-en.txt');
        const words = new Set<string>();
        for (const line of readFileSync(lexicon, 'utf8').split('\n')) {
          const word = line.split(/\s/, 1)[0];
          if (word) {
            words.add(word.toLowerCase());
          }
        }
        const require = createRequire(import.meta.url);
        const sherpa = require('sherpa-onnx-node') as TtsModule;
        this.engine = await sherpa.OfflineTts.createAsync({
          model: {
            kokoro: {
              model: path.join(this.dir, 'model.int8.onnx'),
              voices: path.join(this.dir, 'voices.bin'),
              tokens: path.join(this.dir, 'tokens.txt'),
              lexicon,
              lang: 'en-us',
            },
            numThreads: 2,
            provider: 'cpu',
          },
          maxNumSentences: 2,
        });
        this.words = words;
        return true;
      } catch (error) {
        logWarn('voice', 'Natural voice failed to load', error);
        this.loading = null;
        return false;
      }
    })();
    return this.loading;
  }

  canSay(text: string): boolean {
    const words = this.words;
    return words !== null && speechWords(text).every((word) => words.has(word) || /^\d+$/.test(word));
  }

  async warm(): Promise<void> {
    await this.load();
  }

  async speak(text: string): Promise<SpeechAudio | null> {
    const trimmed = text.trim().slice(0, MAX_CHARS);
    if (trimmed === '' || !(await this.load()) || !this.engine || !this.canSay(trimmed)) {
      return null;
    }
    try {
      const audio = await this.engine.generateAsync({
        text: trimmed,
        sid: SPEAKER,
        speed: 1,
        enableExternalBuffer: false,
      });
      return audio.samples.length > 0 ? { samples: audio.samples, sampleRate: audio.sampleRate } : null;
    } catch (error) {
      logWarn('voice', 'Natural voice failed to speak', error);
      return null;
    }
  }
}
