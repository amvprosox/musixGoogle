import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import {
  AI_BUDGET_MS,
  aiRequestBody,
  attemptAfterStatus,
  chatContent,
  cooldownFor,
  FREE_MODELS_URL,
  freeModelsFrom,
  intentPrompt,
  OPENROUTER_BASE,
  orderFreeModels,
  parseAiIntent,
  revealBuiltinKey,
  type FreeModel,
} from '../shared/ai-intent';

declare const __MUSIX_AI__: string | undefined;
const BUILTIN_AI_KEY = revealBuiltinKey(typeof __MUSIX_AI__ === 'string' ? __MUSIX_AI__ : '');
import type { VoiceCommandEvent, VoiceConfigPatch, VoiceConfigView, VoiceStatus } from '../shared/types';
import {
  isOutOfScope,
  matchIntent,
  normalizeSpeech,
  OUT_OF_SCOPE_REPLY,
  sanitizeVoiceCommands,
  stripWakeWord,
  type VoiceCommand,
} from '../shared/voice-intent';
import { logError, logInfo, logWarn } from './log';
import { connectOpenRouter } from './openrouter-connect';
import {
  installPack,
  installWhisperPack,
  isPackInstalled,
  isWhisperInstalled,
  packDir,
  whisperDir,
} from './voice-pack';

const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;
const DITHER = 2e-4;
const AWAIT_COMMAND_MS = 6000;
const MAX_SEGMENT_SECONDS = 8;
const HISTORY_SECONDS = 14;
const LEAD_IN_SAMPLES = Math.round(SAMPLE_RATE * 0.3);
const MODELS_TTL_MS = 6 * 60 * 60 * 1000;
const AI_TIMEOUT_MS = 9000;

interface StoredVoiceConfig {
  enabled: boolean;
  mic: string;
  commands: VoiceCommand[];
  speakerCheck: boolean;
  speakerThreshold: number;
  sensitivity: number;
  voiceprint: number[];
  aiEnabled: boolean;
  aiKey: string;
}

interface SherpaStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(): void;
}

interface SherpaModule {
  KeywordSpotter: new (config: unknown) => {
    createStream(): SherpaStream;
    isReady(stream: SherpaStream): boolean;
    decode(stream: SherpaStream): void;
    reset(stream: SherpaStream): void;
    getResult(stream: SherpaStream): { keyword?: string };
  };
  OfflineRecognizer: new (config: unknown) => {
    createStream(): SherpaStream;
    decode(stream: SherpaStream): void;
    getResult(stream: SherpaStream): { text?: string };
  };
  SpeakerEmbeddingExtractor: new (config: unknown) => {
    createStream(): SherpaStream;
    compute(stream: SherpaStream, enableExternalBuffer: boolean): Float32Array;
  };
  Vad: new (
    config: unknown,
    bufferSeconds: number,
  ) => {
    acceptWaveform(samples: Float32Array): void;
    isDetected(): boolean;
    isEmpty(): boolean;
    front(enableExternalBuffer: boolean): { samples: Float32Array; start: number };
    pop(): void;
    reset(): void;
  };
}

type Engines = {
  kws: InstanceType<SherpaModule['KeywordSpotter']>;
  kwsStream: SherpaStream;
  asr: InstanceType<SherpaModule['OfflineRecognizer']>;
  speaker: InstanceType<SherpaModule['SpeakerEmbeddingExtractor']>;
  vad: InstanceType<SherpaModule['Vad']>;
};

const DEFAULTS: StoredVoiceConfig = {
  enabled: false,
  mic: 'default',
  commands: sanitizeVoiceCommands(undefined),
  speakerCheck: true,
  speakerThreshold: 0.45,
  sensitivity: 0.5,
  voiceprint: [],
  aiEnabled: true,
  aiKey: '',
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function normalize(vector: ArrayLike<number>): number[] {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const v = vector[i] ?? 0;
    sum += v * v;
  }
  const norm = Math.sqrt(sum) || 1;
  return Array.from({ length: vector.length }, (_, i) => (vector[i] ?? 0) / norm);
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

function joinAudio(first: Float32Array | null, second: Float32Array): Float32Array {
  if (!first) {
    return second;
  }
  const joined = new Float32Array(first.length + second.length);
  joined.set(first, 0);
  joined.set(second, first.length);
  return joined;
}

function dropLeadingWords(text: string, commands: readonly VoiceCommand[]): string {
  const words = text.split(' ').filter((word) => word !== '');
  let best = words.slice(1).join(' ');
  let bestScore = -1;
  for (const take of [1, 2]) {
    const rest = words.slice(take).join(' ');
    const intent = rest === '' ? null : matchIntent(rest, commands);
    const score = intent ? intent.score : -1;
    if (score > bestScore) {
      bestScore = score;
      best = rest;
    }
  }
  return best;
}

const WAKE_KEYWORDS = [
  '▁PRO SE C S @PROSECS',
  '▁PRO ▁SE C S @PROSECS',
  '▁PRO ▁SE X @PROSECS',
  '▁PRO SE X @PROSECS',
  '▁PRO ▁SE K S @PROSECS',
  '▁PRO SE K S @PROSECS',
  '▁PRO ▁SE CK S @PROSECS',
].join('\n');

function wakeKeywordsFile(dir: string): string {
  const file = path.join(dir, 'kws/keywords-prosecs.txt');
  try {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== `${WAKE_KEYWORDS}\n`) {
      writeFileSync(file, `${WAKE_KEYWORDS}\n`);
    }
  } catch (error) {
    logWarn('voice', 'Could not write the wake word file', error);
  }
  return file;
}

export interface VoiceManagerOptions {
  userDataDir: string;
  onStatus: (status: VoiceStatus) => void;
  onCommand: (command: VoiceCommandEvent) => void;
  onDuck: (ducked: boolean) => void;
  isOnline: () => boolean;
  openExternal: (url: string) => Promise<void>;
  onLevel?: (level: number) => void;
}

export class VoiceManager {
  private readonly voiceDir: string;
  private readonly configPath: string;
  private config: StoredVoiceConfig;
  private status: VoiceStatus = { state: 'off', progress: 0, message: '', heard: '' };
  private engines: Engines | null = null;
  private loading: Promise<void> | null = null;
  private downloading: Promise<void> | null = null;
  private vadPending: number[] = [];
  private readonly history = new Float32Array(SAMPLE_RATE * HISTORY_SECONDS);
  private vadFed = 0;
  private keywordHeard = false;
  private awaitingUntil = 0;
  private wakeAudio: Float32Array | null = null;
  private segments: Promise<void> = Promise.resolve();
  private freeModels: FreeModel[] = [];
  private modelsFetchedAt = 0;
  private connecting = false;
  private whisperDownload: Promise<void> | null = null;
  private lastGoodModel: string | null = null;
  private readonly modelCooldowns = new Map<string, number>();

  constructor(private readonly options: VoiceManagerOptions) {
    this.voiceDir = path.join(options.userDataDir, 'voice');
    this.configPath = path.join(this.voiceDir, 'voice.json');
    this.config = this.loadConfig();
    this.refreshIdleStatus();
    if (this.config.enabled && isPackInstalled(this.voiceDir)) {
      void this.ensureEngines();
    }
  }

  private loadConfig(): StoredVoiceConfig {
    try {
      if (!existsSync(this.configPath)) {
        return { ...DEFAULTS, commands: sanitizeVoiceCommands(undefined) };
      }
      const raw = JSON.parse(readFileSync(this.configPath, 'utf8')) as Partial<
        Record<keyof StoredVoiceConfig, unknown>
      >;
      return {
        enabled: raw.enabled === true,
        mic: typeof raw.mic === 'string' && raw.mic.length < 300 ? raw.mic : 'default',
        commands: sanitizeVoiceCommands(raw.commands),
        speakerCheck: raw.speakerCheck !== false,
        speakerThreshold:
          typeof raw.speakerThreshold === 'number' ? clamp(raw.speakerThreshold, 0.1, 0.95) : 0.45,
        sensitivity: typeof raw.sensitivity === 'number' ? clamp(raw.sensitivity, 0, 1) : 0.5,
        voiceprint: Array.isArray(raw.voiceprint)
          ? raw.voiceprint
              .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
              .slice(0, 1024)
          : [],
        aiEnabled: raw.aiEnabled !== false,
        aiKey: typeof raw.aiKey === 'string' ? raw.aiKey : '',
      };
    } catch (error) {
      logWarn('voice', 'Could not read voice settings', error);
      return { ...DEFAULTS, commands: sanitizeVoiceCommands(undefined) };
    }
  }

  private saveConfig(): void {
    try {
      mkdirSync(this.voiceDir, { recursive: true });
      const tmp = `${this.configPath}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.config, null, 2), 'utf8');
      renameSync(tmp, this.configPath);
    } catch (error) {
      logError('voice', 'Could not save voice settings', error);
    }
  }

  view(): VoiceConfigView {
    return {
      enabled: this.config.enabled,
      mic: this.config.mic,
      commands: this.config.commands.map((command) => ({ ...command, phrases: [...command.phrases] })),
      speakerCheck: this.config.speakerCheck,
      speakerThreshold: this.config.speakerThreshold,
      sensitivity: this.config.sensitivity,
      hasVoiceprint: this.config.voiceprint.length > 0,
      aiEnabled: this.config.aiEnabled,
      hasAiKey: this.config.aiKey !== '' || BUILTIN_AI_KEY !== '',
      builtinAi: BUILTIN_AI_KEY !== '' && this.config.aiKey === '',
      packInstalled: isPackInstalled(this.voiceDir),
      whisper: isWhisperInstalled(this.voiceDir),
      freeModels: this.freeModels.length,
    };
  }

  currentStatus(): VoiceStatus {
    return { ...this.status };
  }

  private setStatus(next: Partial<VoiceStatus>): void {
    this.status = { ...this.status, ...next };
    this.options.onStatus({ ...this.status });
  }

  private refreshIdleStatus(): void {
    if (!this.config.enabled) {
      this.setStatus({ state: 'off', progress: 0, message: '' });
      return;
    }
    if (!isPackInstalled(this.voiceDir)) {
      this.setStatus({
        state: 'no-pack',
        progress: 0,
        message: 'Download the voice pack to start listening.',
      });
      return;
    }
    if (this.engines) {
      this.setStatus({ state: 'listening', progress: 0, message: 'Listening for "Prosecs"' });
    }
  }

  update(patch: VoiceConfigPatch): VoiceConfigView {
    if (patch.enabled !== undefined) {
      this.config.enabled = patch.enabled;
    }
    if (patch.mic !== undefined) {
      this.config.mic = patch.mic.slice(0, 300);
    }
    if (patch.commands !== undefined) {
      this.config.commands = sanitizeVoiceCommands(patch.commands);
    }
    if (patch.speakerCheck !== undefined) {
      this.config.speakerCheck = patch.speakerCheck;
    }
    if (patch.speakerThreshold !== undefined) {
      this.config.speakerThreshold = clamp(patch.speakerThreshold, 0.1, 0.95);
    }
    if (patch.sensitivity !== undefined) {
      const changed = patch.sensitivity !== this.config.sensitivity;
      this.config.sensitivity = clamp(patch.sensitivity, 0, 1);
      if (changed && this.engines) {
        this.engines = null;
      }
    }
    if (patch.aiEnabled !== undefined) {
      this.config.aiEnabled = patch.aiEnabled;
    }
    this.saveConfig();
    if (this.config.enabled && isPackInstalled(this.voiceDir)) {
      void this.ensureEngines();
    } else {
      this.awaitingUntil = 0;
      this.wakeAudio = null;
    }
    this.refreshIdleStatus();
    return this.view();
  }

  setAiKey(key: string | null): VoiceConfigView {
    const trimmed = (key ?? '').trim();
    if (trimmed === '') {
      this.config.aiKey = '';
    } else if (safeStorage.isEncryptionAvailable()) {
      this.config.aiKey = `enc:${safeStorage.encryptString(trimmed).toString('base64')}`;
    } else {
      this.config.aiKey = `plain:${Buffer.from(trimmed, 'utf8').toString('base64')}`;
    }
    this.freeModels = [];
    this.modelsFetchedAt = 0;
    this.lastGoodModel = null;
    this.modelCooldowns.clear();
    this.saveConfig();
    return this.view();
  }

  async connectAi(): Promise<VoiceConfigView> {
    if (this.connecting) {
      throw new Error('OpenRouter sign-in is already open in your browser.');
    }
    this.connecting = true;
    try {
      const key = await connectOpenRouter({
        openExternal: (url) => this.options.openExternal(url),
        label: 'Musix desktop',
      });
      return this.setAiKey(key);
    } finally {
      this.connecting = false;
    }
  }

  private aiKey(): string {
    return this.ownAiKey() || BUILTIN_AI_KEY;
  }

  private ownAiKey(): string {
    const stored = this.config.aiKey;
    try {
      if (stored.startsWith('enc:')) {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
      }
      if (stored.startsWith('plain:')) {
        return Buffer.from(stored.slice(6), 'base64').toString('utf8');
      }
    } catch (error) {
      logWarn('voice', 'Could not read the AI key', error);
    }
    return '';
  }

  downloadPack(): Promise<void> {
    if (this.downloading) {
      return this.downloading;
    }
    this.setStatus({ state: 'downloading', progress: 0, message: 'Downloading voice pack' });
    let lastReport = 0;
    this.downloading = installPack(this.voiceDir, (fraction) => {
      const now = Date.now();
      if (now - lastReport > 250 || fraction >= 1) {
        lastReport = now;
        this.setStatus({ state: 'downloading', progress: fraction, message: 'Downloading voice pack' });
      }
    })
      .then(async () => {
        this.setStatus({ state: 'loading', progress: 1, message: 'Voice pack ready' });
        if (this.config.enabled) {
          await this.ensureEngines();
        }
        this.refreshIdleStatus();
      })
      .catch((error: unknown) => {
        logError('voice', 'Voice pack download failed', error);
        this.setStatus({
          state: 'error',
          progress: 0,
          message: error instanceof Error ? error.message : 'Voice pack download failed',
        });
      })
      .finally(() => {
        this.downloading = null;
      });
    return this.downloading;
  }

  private ensureEngines(): Promise<void> {
    if (this.engines) {
      return Promise.resolve();
    }
    if (this.loading) {
      return this.loading;
    }
    this.loading = Promise.resolve()
      .then(() => {
        this.setStatus({ state: 'loading', message: 'Starting the voice engine' });
        const dir = packDir(this.voiceDir);
        const require = createRequire(import.meta.url);
        const sherpa = require('sherpa-onnx-node') as SherpaModule;
        const threshold = 0.3 - this.config.sensitivity * 0.2;
        const score = 1 + this.config.sensitivity;
        const kws = new sherpa.KeywordSpotter({
          featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
          modelConfig: {
            transducer: {
              encoder: path.join(dir, 'kws/encoder.int8.onnx'),
              decoder: path.join(dir, 'kws/decoder.int8.onnx'),
              joiner: path.join(dir, 'kws/joiner.int8.onnx'),
            },
            tokens: path.join(dir, 'kws/tokens.txt'),
            numThreads: 1,
            provider: 'cpu',
          },
          maxActivePaths: 4,
          numTrailingBlanks: 1,
          keywordsScore: score,
          keywordsThreshold: threshold,
          keywordsFile: wakeKeywordsFile(dir),
        });
        const asr = new sherpa.OfflineRecognizer({
          featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
          modelConfig: this.recognizerModel(dir),
        });
        const speaker = new sherpa.SpeakerEmbeddingExtractor({
          model: path.join(dir, 'speaker/campplus_en.onnx'),
          numThreads: 1,
        });
        const vad = new sherpa.Vad(
          {
            sileroVad: {
              model: path.join(dir, 'vad/silero_vad.onnx'),
              threshold: 0.5,
              minSilenceDuration: 0.3,
              minSpeechDuration: 0.15,
              windowSize: 512,
              maxSpeechDuration: MAX_SEGMENT_SECONDS,
            },
            sampleRate: SAMPLE_RATE,
            numThreads: 1,
          },
          MAX_SEGMENT_SECONDS + 4,
        );
        this.engines = { kws, kwsStream: kws.createStream(), asr, speaker, vad };
      })
      .catch((error: unknown) => {
        logError('voice', 'Voice engine failed to start', error);
        this.setStatus({ state: 'error', message: 'The voice engine could not start on this computer.' });
      })
      .finally(() => {
        this.loading = null;
        this.refreshIdleStatus();
      });
    return this.loading;
  }

  private recognizerModel(dir: string): Record<string, unknown> {
    if (isWhisperInstalled(this.voiceDir)) {
      const whisper = whisperDir(this.voiceDir);
      return {
        whisper: {
          encoder: path.join(whisper, 'encoder.int8.onnx'),
          decoder: path.join(whisper, 'decoder.int8.onnx'),
          language: 'en',
          task: 'transcribe',
        },
        tokens: path.join(whisper, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
      };
    }
    this.fetchWhisper();
    return {
      transducer: {
        encoder: path.join(dir, 'asr/encoder.int8.onnx'),
        decoder: path.join(dir, 'asr/decoder.int8.onnx'),
        joiner: path.join(dir, 'asr/joiner.int8.onnx'),
      },
      tokens: path.join(dir, 'asr/tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
    };
  }

  private fetchWhisper(): void {
    if (this.whisperDownload || !this.options.isOnline() || isWhisperInstalled(this.voiceDir)) {
      return;
    }
    this.whisperDownload = installWhisperPack(this.voiceDir, () => undefined)
      .then(() => {
        logInfo('voice', 'Whisper speech recognition installed');
        const engines = this.engines;
        if (engines) {
          const require = createRequire(import.meta.url);
          const sherpa = require('sherpa-onnx-node') as SherpaModule;
          engines.asr = new sherpa.OfflineRecognizer({
            featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
            modelConfig: this.recognizerModel(packDir(this.voiceDir)),
          });
        }
        this.options.onStatus({ ...this.status });
      })
      .catch((error: unknown) => {
        logWarn('voice', 'Whisper download failed', error);
      })
      .finally(() => {
        this.whisperDownload = null;
      });
  }

  acceptAudio(samples: Float32Array): void {
    const engines = this.engines;
    if (!this.config.enabled || !engines || samples.length === 0) {
      return;
    }
    const dithered = new Float32Array(samples.length);
    let energy = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i] ?? 0;
      energy += sample * sample;
      dithered[i] = sample + (Math.random() - 0.5) * DITHER;
    }
    this.options.onLevel?.(Math.sqrt(energy / samples.length));
    engines.kwsStream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: dithered });
    while (engines.kws.isReady(engines.kwsStream)) {
      engines.kws.decode(engines.kwsStream);
      if (engines.kws.getResult(engines.kwsStream).keyword) {
        engines.kws.reset(engines.kwsStream);
        this.keywordHeard = true;
        this.wake();
      }
    }
    for (let i = 0; i < dithered.length; i += 1) {
      this.vadPending.push(dithered[i] ?? 0);
    }
    while (this.vadPending.length >= VAD_WINDOW) {
      const window = Float32Array.from(this.vadPending.splice(0, VAD_WINDOW));
      for (let i = 0; i < window.length; i += 1) {
        this.history[(this.vadFed + i) % this.history.length] = window[i] ?? 0;
      }
      this.vadFed += window.length;
      engines.vad.acceptWaveform(window);
      while (!engines.vad.isEmpty()) {
        const segment = engines.vad.front(false);
        engines.vad.pop();
        this.enqueueSegment(engines, this.withLeadIn(segment.start, segment.samples));
      }
    }
    if (this.awaitingUntil > 0 && Date.now() > this.awaitingUntil && !engines.vad.isDetected()) {
      this.awaitingUntil = 0;
      this.wakeAudio = null;
      this.options.onDuck(false);
      this.options.onCommand({ action: 'none', query: '', reply: '', transcript: '', source: 'empty' });
      this.refreshIdleStatus();
    }
  }

  private withLeadIn(start: number, samples: Float32Array): Float32Array {
    const from = Math.max(0, start - LEAD_IN_SAMPLES, this.vadFed - this.history.length);
    const lead = Math.max(0, start - from);
    if (lead === 0 || start > this.vadFed) {
      return Float32Array.from(samples);
    }
    const out = new Float32Array(lead + samples.length);
    for (let i = 0; i < lead; i += 1) {
      out[i] = this.history[(from + i) % this.history.length] ?? 0;
    }
    out.set(samples, lead);
    return out;
  }

  private wake(): void {
    if (this.status.state === 'awake' || this.status.state === 'thinking') {
      return;
    }
    this.setStatus({ state: 'awake', message: 'Yes?', heard: '' });
    this.options.onDuck(true);
  }

  private enqueueSegment(engines: Engines, samples: Float32Array): void {
    const keyword = this.keywordHeard;
    this.keywordHeard = false;
    this.segments = this.segments
      .then(() => this.handleSegment(engines, samples, keyword))
      .catch((error: unknown) => {
        logError('voice', 'Voice segment failed', error);
      });
  }

  private async handleSegment(engines: Engines, samples: Float32Array, keyword: boolean): Promise<void> {
    const text = normalizeSpeech(this.transcribe(engines, samples));
    if (this.awaitingUntil > 0) {
      const cleaned = text.replace(/^(yes|yeah|yep)\b\s*/, '').trim();
      if (cleaned === '' || (stripWakeWord(cleaned).heard && stripWakeWord(cleaned).rest === '')) {
        return;
      }
      this.awaitingUntil = 0;
      const wakeAudio = this.wakeAudio;
      this.wakeAudio = null;
      await this.resolveCommand(engines, joinAudio(wakeAudio, samples), cleaned);
      return;
    }
    const stripped = stripWakeWord(text);
    if (!stripped.heard && !keyword) {
      if (text !== '' && this.status.state === 'listening') {
        this.setStatus({ ...this.status, heard: text });
      }
      return;
    }
    const rest = stripped.heard ? stripped.rest : dropLeadingWords(text, this.config.commands);
    this.wake();
    if (rest === '') {
      this.wakeAudio = samples;
      this.awaitingUntil = Date.now() + AWAIT_COMMAND_MS;
      return;
    }
    await this.resolveCommand(engines, samples, rest);
  }

  private embed(engines: Engines, samples: Float32Array): number[] {
    const stream = engines.speaker.createStream();
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
    stream.inputFinished();
    return normalize(engines.speaker.compute(stream, false));
  }

  private transcribe(engines: Engines, samples: Float32Array): string {
    if (samples.length < SAMPLE_RATE * 0.2) {
      return '';
    }
    const stream = engines.asr.createStream();
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
    engines.asr.decode(stream);
    return (engines.asr.getResult(stream).text ?? '').trim();
  }

  private async resolveCommand(engines: Engines, audio: Float32Array, text: string): Promise<void> {
    try {
      this.setStatus({ state: 'thinking', message: 'Thinking', heard: text });
      if (this.config.speakerCheck && this.config.voiceprint.length > 0) {
        const score = cosine(this.config.voiceprint, this.embed(engines, audio));
        if (score < this.config.speakerThreshold) {
          this.setStatus({ heard: '', message: 'That did not sound like your voice' });
          this.options.onCommand({
            action: 'none',
            query: '',
            reply: '',
            transcript: '',
            source: 'rejected',
          });
          return;
        }
      }
      if (text === '') {
        this.options.onCommand({ action: 'none', query: '', reply: '', transcript: '', source: 'empty' });
        return;
      }
      const local = matchIntent(text, this.config.commands);
      if (local) {
        this.options.onCommand({
          action: local.action,
          query: local.query,
          reply: '',
          transcript: text,
          source: 'local',
        });
        return;
      }
      if (isOutOfScope(text)) {
        this.options.onCommand({
          action: 'none',
          query: '',
          reply: OUT_OF_SCOPE_REPLY,
          transcript: text,
          source: 'blocked',
        });
        return;
      }
      const ai = await this.askAi(text);
      this.options.onCommand(
        ai ?? { action: 'none', query: '', reply: '', transcript: text, source: 'unknown' },
      );
    } catch (error) {
      logError('voice', 'Voice command failed', error);
      this.options.onCommand({ action: 'none', query: '', reply: '', transcript: '', source: 'unknown' });
    } finally {
      this.options.onDuck(false);
      this.refreshIdleStatus();
    }
  }

  private async loadFreeModels(key: string): Promise<FreeModel[]> {
    if (this.freeModels.length > 0 && Date.now() - this.modelsFetchedAt < MODELS_TTL_MS) {
      return this.freeModels;
    }
    const response = await fetch(FREE_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Model list HTTP ${response.status}`);
    }
    this.freeModels = freeModelsFrom(await response.json());
    this.modelsFetchedAt = Date.now();
    return this.freeModels;
  }

  private async askAi(transcript: string): Promise<VoiceCommandEvent | null> {
    const key = this.aiKey();
    if (!this.config.aiEnabled || key === '' || !this.options.isOnline()) {
      return null;
    }
    let models: FreeModel[];
    try {
      models = await this.loadFreeModels(key);
    } catch (error) {
      logWarn('voice', 'Could not load free AI models', error);
      return null;
    }
    const messages = intentPrompt(transcript, !this.options.isOnline());
    const deadline = Date.now() + AI_BUDGET_MS;
    for (const model of orderFreeModels(models, this.lastGoodModel, this.modelCooldowns, Date.now())) {
      if (Date.now() > deadline) {
        break;
      }
      let status: number | null = null;
      try {
        const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'X-Title': 'Musix',
          },
          body: aiRequestBody(model.id, messages),
          signal: AbortSignal.timeout(Math.min(AI_TIMEOUT_MS, Math.max(1000, deadline - Date.now()))),
        });
        status = response.status;
        if (response.ok) {
          const parsed = parseAiIntent(chatContent(await response.json()));
          if (parsed) {
            this.lastGoodModel = model.id;
            this.modelCooldowns.delete(model.id);
            return { ...parsed, transcript, source: 'ai' };
          }
        } else if (attemptAfterStatus(response.status) === 'stop') {
          logWarn('voice', `OpenRouter refused the key (HTTP ${response.status})`);
          return null;
        }
      } catch (error) {
        logWarn('voice', `AI model ${model.id} failed`, error);
      }
      this.modelCooldowns.set(model.id, Date.now() + cooldownFor(status));
      if (this.lastGoodModel === model.id) {
        this.lastGoodModel = null;
      }
    }
    return null;
  }

  async enroll(clips: Float32Array[]): Promise<{ ok: boolean; threshold: number; message: string }> {
    await this.ensureEngines();
    const engines = this.engines;
    if (!engines) {
      return { ok: false, threshold: this.config.speakerThreshold, message: 'Voice engine is not ready.' };
    }
    const usable = clips.filter((clip) => clip.length >= SAMPLE_RATE);
    if (usable.length < 3) {
      return {
        ok: false,
        threshold: this.config.speakerThreshold,
        message: 'Say each phrase for at least a second.',
      };
    }
    const embeddings = usable.map((clip) => this.embed(engines, clip));
    const dim = embeddings[0]?.length ?? 0;
    const mean = normalize(
      Array.from(
        { length: dim },
        (_, i) => embeddings.reduce((sum, e) => sum + (e[i] ?? 0), 0) / embeddings.length,
      ),
    );
    const selfScores = embeddings.map((e) => cosine(mean, e));
    const lowest = Math.min(...selfScores);
    const threshold = clamp(Math.round((lowest - 0.15) * 100) / 100, 0.25, 0.7);
    this.config.voiceprint = mean;
    this.config.speakerThreshold = threshold;
    this.config.speakerCheck = true;
    this.saveConfig();
    return { ok: true, threshold, message: `Voice saved. Match threshold set to ${threshold.toFixed(2)}.` };
  }

  async testVoice(clip: Float32Array): Promise<number | null> {
    await this.ensureEngines();
    const engines = this.engines;
    if (!engines || this.config.voiceprint.length === 0 || clip.length < SAMPLE_RATE * 0.5) {
      return null;
    }
    return Math.round(cosine(this.config.voiceprint, this.embed(engines, clip)) * 1000) / 1000;
  }

  forgetVoice(): VoiceConfigView {
    this.config.voiceprint = [];
    this.saveConfig();
    return this.view();
  }
}
