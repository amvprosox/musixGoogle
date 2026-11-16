import { isResolvedTheme } from '../shared/settings';
import type {
  DownloadItem,
  PaletteName,
  SavedLibrary,
  VoiceCommandEvent,
  VoiceConfigPatch,
  VoiceConfigView,
  VoiceStatus,
  VoiceStep,
} from '../shared/types';
import { normalizeSpeech, similarity, type VoiceAction } from '../shared/voice-intent';
import type { AppContext } from './context';

const SAMPLE_RATE = 16000;
const CHUNK = 1600;
const YES_URL = 'musix-asset://voice/yes.wav';

export interface MicDevice {
  id: string;
  label: string;
}

type Listener = () => void;

function bestMatch<T>(query: string, items: readonly T[], text: (item: T) => string[]): T | null {
  const needle = normalizeSpeech(query);
  if (needle === '') {
    return null;
  }
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    for (const raw of text(item)) {
      const hay = normalizeSpeech(raw);
      if (hay === '') {
        continue;
      }
      const contains = hay.includes(needle) || needle.includes(hay) ? 0.9 : 0;
      const score = Math.max(contains, similarity(needle, hay));
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
  }
  return bestScore >= 0.55 ? best : null;
}

function paletteFromSpeech(query: string): PaletteName | null {
  const text = normalizeSpeech(query);
  const table: [PaletteName, string[]][] = [
    ['graphite', ['graphite', 'grey', 'gray', 'dark grey', 'dark gray']],
    ['slate', ['slate', 'slate grey', 'slate gray', 'light grey', 'light gray']],
    ['amoled', ['amoled', 'black', 'pure black', 'oled']],
    ['light', ['light', 'white', 'bright', 'day']],
    ['dark', ['midnight', 'dark', 'blue', 'navy', 'night']],
  ];
  let best: PaletteName | null = null;
  let bestScore = 0;
  for (const [palette, words] of table) {
    for (const word of words) {
      const score = text.includes(word) ? 1 : similarity(text, word);
      if (score > bestScore) {
        bestScore = score;
        best = palette;
      }
    }
  }
  return bestScore >= 0.6 && best && isResolvedTheme(best) ? best : null;
}

type ReplyKey =
  | 'which-playlist'
  | 'which-one'
  | 'which-song'
  | 'done'
  | 'on-it'
  | 'playing'
  | 'shuffle-on'
  | 'shuffle-off'
  | 'repeat-all'
  | 'repeat-one'
  | 'repeat-off'
  | 'paused'
  | 'resumed'
  | 'next'
  | 'previous'
  | 'liked'
  | 'disliked'
  | 'volume-up'
  | 'volume-down'
  | 'muted'
  | 'unmuted'
  | 'lyrics'
  | 'downloading'
  | 'theme'
  | 'opening'
  | 'searching'
  | 'restart'
  | 'offline-playing'
  | 'okay'
  | 'sorry'
  | 'scope'
  | 'nothing'
  | 'not-found'
  | 'no-downloads'
  | 'no-playlist'
  | 'play-first'
  | 'not-you'
  | 'now-playing'
  | 'online'
  | 'downloaded';

const REPLY_PATTERNS: [RegExp, ReplyKey][] = [
  [/did not catch|didn't catch|not understand/i, 'sorry'],
  [/only control musix|only help with your music/i, 'scope'],
  [/nothing is playing/i, 'nothing'],
  [/find that playlist/i, 'no-playlist'],
  [/could not find|couldn't find/i, 'not-found'],
  [/no downloads/i, 'no-downloads'],
  [/play a song first/i, 'play-first'],
  [/sound like/i, 'not-you'],
  [/^this is |what's playing|what is playing/i, 'now-playing'],
  [/online|connection/i, 'online'],
  [/already downloaded/i, 'downloaded'],
];

const ACK_REPLY: Readonly<Record<VoiceAction, ReplyKey | null>> = {
  pause: 'paused',
  resume: 'resumed',
  next: 'next',
  previous: 'previous',
  shuffleOn: 'shuffle-on',
  shuffleOff: 'shuffle-off',
  repeat: 'repeat-all',
  repeatOne: 'repeat-one',
  repeatOff: 'repeat-off',
  like: 'liked',
  dislike: 'disliked',
  volumeUp: 'volume-up',
  volumeDown: 'volume-down',
  mute: 'muted',
  unmute: 'unmuted',
  seekForward: 'done',
  seekBack: 'done',
  restart: 'restart',
  whatsPlaying: null,
  showLyrics: 'lyrics',
  hideLyrics: 'done',
  downloadSong: 'downloading',
  setTheme: 'theme',
  search: 'searching',
  play: 'playing',
  playDownloads: 'offline-playing',
  playDownloadedPlaylist: 'playing',
  openHome: 'opening',
  openExplore: 'opening',
  openLibrary: 'opening',
  openLiked: 'opening',
  openPlaylists: 'opening',
  openDownloads: 'opening',
  openSettings: 'opening',
  openQueue: 'opening',
  openSearch: 'opening',
};

function replyKey(text: string): ReplyKey {
  return REPLY_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? 'okay';
}

export class VoiceController {
  config: VoiceConfigView | null = null;
  status: VoiceStatus = { state: 'off', progress: 0, message: '', heard: '' };
  devices: MicDevice[] = [];
  activeMic = '';
  private readonly listeners = new Set<Listener>();
  private readonly levelListeners = new Set<(level: number) => void>();
  private defaultLabel = '';
  private restarting = false;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: AudioWorkletNode | null = null;
  private pending: number[] = [];
  private recording: number[] | null = null;
  private yes: HTMLAudioElement | null = null;
  private replyAudio: HTMLAudioElement | null = null;
  private spoke = false;
  private speaking = 0;
  private envelope = 0.05;
  private quietUntil = 0;

  constructor(private readonly ctx: AppContext) {
    const { api } = ctx;
    api.on('voice:status', (status) => {
      const wasAwake = this.status.state === 'awake';
      this.status = status;
      if (status.state === 'awake' && !wasAwake) {
        this.playYes();
        this.ctx.actions.duckOffline(true);
      }
      if (status.state === 'listening' || status.state === 'off') {
        this.ctx.actions.duckOffline(false);
      }
      this.emit();
    });
    api.on('voice:command', (command) => {
      this.ctx.actions.duckOffline(false);
      void this.execute(command);
    });
    navigator.mediaDevices.addEventListener('devicechange', () => {
      void this.refreshDevices(true, true);
    });
    api
      .invoke('voice:get', null)
      .then(({ config, status }) => {
        this.config = config;
        this.status = status;
        this.emit();
        void this.syncCapture();
      })
      .catch(() => undefined);
  }

  onLevel(listener: (level: number) => void): () => void {
    this.levelListeners.add(listener);
    return () => {
      this.levelListeners.delete(listener);
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  async update(patch: VoiceConfigPatch): Promise<void> {
    this.config = await this.ctx.api.invoke('voice:set', patch);
    this.emit();
    await this.syncCapture();
  }

  async setAiKey(key: string | null): Promise<void> {
    this.config = await this.ctx.api.invoke('voice:set-ai-key', key);
    this.emit();
  }

  async connectAi(): Promise<void> {
    this.config = await this.ctx.api.invoke('voice:connect-ai', null);
    this.emit();
  }

  async downloadPack(): Promise<void> {
    await this.ctx.api.invoke('voice:download-pack', null);
    const { config } = await this.ctx.api.invoke('voice:get', null);
    this.config = config;
    this.emit();
    await this.syncCapture();
  }

  async forgetVoice(): Promise<void> {
    this.config = await this.ctx.api.invoke('voice:forget', null);
    this.emit();
  }

  private async automaticMic(): Promise<string | null> {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput',
    );
    const wireless = /bluetooth|airpods|beats|hands-?free|headset|buds|bose|sony wh|jabra/i;
    // Virtual inputs that carry the computer's own sound instead of a real microphone.
    const loopback =
      /blackhole|loopback|soundflower|aggregate|multi-output|background music|eqmac|vb-audio|cable output|stereo mix|what u hear|monitor of|zoomaudio|teams audio|virtual/i;
    const avoid = (label: string): boolean => wireless.test(label) || loopback.test(label);
    const fallback = inputs.find((device) => device.deviceId === 'default') ?? inputs[0];
    if (!fallback || !avoid(fallback.label)) {
      return null;
    }
    const builtIn =
      inputs.find(
        (device) => device.deviceId !== 'default' && /built-in|macbook|internal/i.test(device.label),
      ) ??
      inputs.find((device) => device.deviceId !== 'default' && device.label !== '' && !avoid(device.label));
    return builtIn?.deviceId ?? null;
  }

  private async refreshDevices(announce: boolean, followChanges = false): Promise<void> {
    const before = new Set(this.devices.map((device) => device.id));
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all
      .filter((device) => device.kind === 'audioinput')
      .map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }));
    const added = this.devices.find((device) => !before.has(device.id) && device.id !== 'default');
    if (announce && added) {
      this.ctx.toasts.show({ variant: 'info', title: 'Microphone connected', message: added.label });
    }
    const defaultLabel =
      all.find((device) => device.kind === 'audioinput' && device.deviceId === 'default')?.label ?? '';
    const wanted = this.config?.mic ?? 'default';
    const currentTrack = this.stream?.getAudioTracks()[0];
    const currentId = currentTrack?.getSettings().deviceId ?? '';
    const defaultMoved =
      wanted === 'default' && this.defaultLabel !== '' && defaultLabel !== this.defaultLabel;
    const currentGone = wanted !== 'default' && !this.devices.some((device) => device.id === currentId);
    this.defaultLabel = defaultLabel;
    if (followChanges && this.stream && !this.restarting && (defaultMoved || currentGone)) {
      this.restarting = true;
      try {
        await this.restartCapture();
      } finally {
        this.restarting = false;
      }
    }
    this.emit();
  }

  private async syncCapture(): Promise<void> {
    const config = this.config;
    const shouldListen =
      config !== null &&
      config.enabled &&
      config.packInstalled &&
      this.status.state !== 'error' &&
      this.status.state !== 'no-pack';
    if (shouldListen && !this.stream) {
      await this.startCapture();
    } else if (!shouldListen && this.stream && this.recording === null) {
      this.stopCapture();
    }
  }

  private async restartCapture(): Promise<void> {
    this.stopCapture();
    await this.syncCapture();
  }

  private async startCapture(): Promise<void> {
    const wanted = this.config?.mic ?? 'default';
    try {
      const constraints: MediaTrackConstraints = {
        channelCount: 1,
        // Chromium's own echo canceller removes everything Musix plays (music, Lauren's
        // replies) from the mic without switching macOS into voice-call mode.
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
      };
      if (wanted !== 'default' && wanted !== '') {
        constraints.deviceId = { exact: wanted };
      } else {
        const safe = await this.automaticMic();
        if (safe) {
          constraints.deviceId = { exact: safe };
        }
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
      } catch {
        delete constraints.deviceId;
        stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
      }
      const context = new AudioContext({ sampleRate: SAMPLE_RATE });
      await context.audioWorklet.addModule('musix-asset://voice/mic-worklet.js');
      const source = context.createMediaStreamSource(stream);
      const processor = new AudioWorkletNode(context, 'musix-mic');
      processor.port.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data instanceof Float32Array) {
          this.onAudio(event.data);
        }
      };
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      this.stream = stream;
      this.context = context;
      this.processor = processor;
      this.activeMic = stream.getAudioTracks()[0]?.label ?? '';
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        void this.restartCapture();
      });
      await this.refreshDevices(false);
    } catch (error) {
      this.activeMic = '';
      this.ctx.toasts.show({
        variant: 'error',
        title: 'Microphone unavailable',
        message:
          error instanceof Error ? error.message : 'Allow microphone access to use the voice assistant.',
      });
    }
    this.emit();
  }

  private stopCapture(): void {
    this.processor?.port.close();
    this.processor?.disconnect();
    this.processor = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.activeMic = '';
    this.pending = [];
    this.emit();
  }

  private boost(input: Float32Array): Float32Array {
    let peak = 0;
    for (const value of input) {
      peak = Math.max(peak, Math.abs(value));
    }
    this.envelope = Math.max(this.envelope * 0.995, peak);
    const maxGain = this.config?.micBoost ?? 6;
    const gain = Math.min(maxGain, Math.max(1, 0.6 / Math.max(this.envelope, 0.02)));
    if (gain <= 1.01) {
      return input;
    }
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      out[i] = Math.max(-1, Math.min(1, (input[i] ?? 0) * gain));
    }
    return out;
  }

  private onAudio(raw: Float32Array): void {
    if (this.speaking > 0 || Date.now() < this.quietUntil) {
      this.pending = [];
      for (const listener of this.levelListeners) {
        listener(0);
      }
      return;
    }
    const samples = this.boost(raw);
    let energy = 0;
    for (const value of samples) {
      energy += value * value;
    }
    const level = Math.min(1, Math.sqrt(energy / Math.max(1, samples.length)) * 4);
    for (const listener of this.levelListeners) {
      listener(level);
    }
    if (this.recording) {
      for (const value of samples) {
        this.recording.push(value);
      }
      return;
    }
    for (const value of samples) {
      this.pending.push(value);
    }
    while (this.pending.length >= CHUNK) {
      const chunk = Float32Array.from(this.pending.splice(0, CHUNK));
      this.ctx.api.send('voice:audio', chunk);
    }
  }

  async record(seconds: number): Promise<Float32Array> {
    const hadStream = this.stream !== null;
    if (!hadStream) {
      await this.startCapture();
    }
    this.recording = [];
    await new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));
    const clip = Float32Array.from(this.recording);
    this.recording = null;
    if (!hadStream) {
      await this.syncCapture();
    }
    return clip;
  }

  private playYes(): void {
    if (!this.yes) {
      this.yes = new Audio(YES_URL);
      this.yes.preload = 'auto';
    }
    this.yes.currentTime = 0;
    // The mic stays open during "Yes?" (echo cancellation removes it) so a command
    // said straight after Veru is heard in full.
    this.yes.play().catch(() => undefined);
  }

  private trackSpeech(audio: HTMLAudioElement): void {
    this.speaking += 1;
    let finished = false;
    const end = (): void => {
      if (!finished) {
        finished = true;
        this.speechEnded();
      }
    };
    audio.addEventListener('ended', end, { once: true });
    audio.addEventListener('error', end, { once: true });
    audio.addEventListener('pause', end, { once: true });
  }

  private speechEnded(): void {
    this.speaking = Math.max(0, this.speaking - 1);
    this.quietUntil = Date.now() + 350;
  }

  private say(text: string): void {
    this.spoke = true;
    this.reply(replyKey(text));
  }

  private reply(key: ReplyKey): void {
    this.replyAudio?.pause();
    const audio = new Audio(`musix-asset://voice/replies/${key}.wav`);
    audio.volume = 1;
    this.replyAudio = audio;
    this.ctx.actions.duckOffline(true);
    const done = (): void => {
      if (this.replyAudio === audio) {
        this.replyAudio = null;
        this.ctx.actions.duckOffline(false);
      }
    };
    audio.addEventListener('ended', done, { once: true });
    audio.addEventListener('error', done, { once: true });
    this.trackSpeech(audio);
    audio.play().catch(() => {
      done();
      this.speechEnded();
    });
  }

  private notify(title: string, message: string): void {
    this.ctx.toasts.show({ variant: 'info', title, message });
  }

  private async savedLibraries(): Promise<SavedLibrary[]> {
    try {
      return await this.ctx.api.invoke('downloads:saved-libraries', null);
    } catch {
      return [];
    }
  }

  private completedDownloads(): DownloadItem[] {
    return this.ctx.store
      .getState()
      .downloads.filter((item) => item.status === 'completed' && item.audioUrl !== '');
  }

  private async repeatTo(target: 'NONE' | 'ALL' | 'ONE'): Promise<void> {
    const order = ['NONE', 'ALL', 'ONE'] as const;
    const current = this.ctx.store.getState().player?.repeatMode ?? 'NONE';
    const presses = (order.indexOf(target) - order.indexOf(current) + 3) % 3;
    for (let i = 0; i < presses; i += 1) {
      this.ctx.actions.cycleRepeat();
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
  }

  private async execute(command: VoiceCommandEvent): Promise<void> {
    const steps: VoiceStep[] =
      command.steps ?? (command.action === 'none' ? [] : [{ action: command.action, query: command.query }]);
    if (steps.length === 0 && command.question) {
      this.ask(command);
      return;
    }
    if (steps.length === 0) {
      await this.runStep(command);
      return;
    }
    this.notify('Voice assistant', command.transcript === '' ? (steps[0]?.action ?? '') : command.transcript);
    let ack: ReplyKey | null = null;
    for (const [index, step] of steps.entries()) {
      this.spoke = false;
      await this.runStep({ ...command, action: step.action, query: step.query, reply: '' });
      ack = this.hasSpoken() ? null : ACK_REPLY[step.action];
      if (index < steps.length - 1) {
        const settle = step.action === 'play' || step.action.startsWith('playDownload') ? 1800 : 350;
        await new Promise((resolve) => window.setTimeout(resolve, settle));
      }
    }
    if (command.question) {
      this.ask(command);
    } else if (ack) {
      this.reply(ack);
    }
  }

  private hasSpoken(): boolean {
    return this.spoke;
  }

  private ask(command: VoiceCommandEvent): void {
    const key: ReplyKey =
      command.choice === 'playlist'
        ? 'which-playlist'
        : command.choice === 'song'
          ? 'which-song'
          : 'which-one';
    this.reply(key);
    if (command.choice === 'playlist') {
      void this.savedLibraries().then((libraries) => {
        const names = libraries.map((lib) => lib.title).slice(0, 6);
        this.notify(
          command.question ?? 'Which playlist?',
          names.length > 0 ? `Say one: ${names.join(', ')}` : 'Say its name.',
        );
      });
    } else {
      this.notify('Voice assistant', command.question ?? 'Which one?');
    }
  }

  private async runStep(command: VoiceCommandEvent): Promise<void> {
    const { actions, store, router, api } = this.ctx;
    const player = store.getState().player;
    if (command.action === 'none') {
      if (command.source === 'blocked') {
        this.notify('Voice assistant', command.reply);
        this.say(command.reply);
      } else if (command.source === 'rejected') {
        this.notify('Voice assistant', 'That did not sound like your voice.');
        this.reply('not-you');
      } else if (command.source === 'empty') {
        this.notify('Voice assistant', 'I did not hear a command.');
      } else {
        const heard = command.transcript === '' ? '' : ` "${command.transcript}"`;
        this.notify('Voice assistant', `Sorry, I did not understand${heard}.`);
        this.say(command.reply || 'Sorry, I did not catch that.');
      }
      return;
    }
    const offline = !navigator.onLine || actions.isOfflineActive();
    switch (command.action) {
      case 'pause':
        actions.handleRemote({ type: 'pause' });
        return;
      case 'resume':
        actions.handleRemote({ type: 'play' });
        return;
      case 'next':
        actions.next();
        return;
      case 'previous':
        actions.previous();
        return;
      case 'shuffleOn':
        if (player && !player.shuffle) {
          actions.toggleShuffle();
        }
        return;
      case 'shuffleOff':
        if (player?.shuffle) {
          actions.toggleShuffle();
        }
        return;
      case 'repeat':
        await this.repeatTo('ALL');
        return;
      case 'repeatOne':
        await this.repeatTo('ONE');
        return;
      case 'repeatOff':
        await this.repeatTo('NONE');
        return;
      case 'like':
        if (player && player.likeStatus !== 'LIKE') {
          actions.toggleLike();
        }
        return;
      case 'dislike':
        if (player && player.likeStatus !== 'DISLIKE') {
          actions.toggleDislike();
        }
        return;
      case 'volumeUp':
        actions.stepVolume(1);
        actions.stepVolume(1);
        actions.stepVolume(1);
        return;
      case 'volumeDown':
        actions.stepVolume(-1);
        actions.stepVolume(-1);
        actions.stepVolume(-1);
        return;
      case 'mute':
        if (player && !player.isMuted) {
          actions.toggleMute();
        }
        return;
      case 'unmute':
        if (player?.isMuted) {
          actions.toggleMute();
        }
        return;
      case 'seekForward':
        actions.seekRelative(1);
        return;
      case 'seekBack':
        actions.seekRelative(-1);
        return;
      case 'restart':
        actions.seekTo(0);
        return;
      case 'whatsPlaying':
        if (player?.hasTrack) {
          const line = player.artist !== '' ? `${player.title} by ${player.artist}` : player.title;
          this.notify('Now playing', line);
          this.say(`This is ${line}`);
        } else {
          this.say('Nothing is playing right now.');
        }
        return;
      case 'showLyrics':
        store.dispatch({ type: 'lyrics-open', open: true });
        return;
      case 'hideLyrics':
        store.dispatch({ type: 'lyrics-open', open: false });
        return;
      case 'downloadSong':
        if (player?.hasTrack && !player.isAd && player.videoId !== '') {
          await api.invoke('downloads:start', {
            videoId: player.videoId,
            title: player.title,
            artist: player.artist,
            album: player.album,
            durationSec: player.durationSec,
            artworkUrl: player.artworkUrl,
          });
        }
        return;
      case 'setTheme': {
        const palette = paletteFromSpeech(command.query);
        if (palette) {
          const settings = await api.invoke('settings:set', { theme: palette });
          store.dispatch({ type: 'settings', settings });
        } else {
          this.notify('Voice assistant', `I do not know the "${command.query}" theme.`);
        }
        return;
      }
      case 'search':
        if (!router.search(command.query)) {
          this.notify('Voice assistant', 'Search is not available right now.');
        }
        return;
      case 'play': {
        if (!offline) {
          const title = await api.invoke('voice:play-search', { query: command.query, kind: 'any' });
          if (title) {
            this.notify('Playing', title);
            return;
          }
        }
        const downloads = this.completedDownloads();
        const match = bestMatch(command.query, downloads, (item) => [
          item.title,
          `${item.title} ${item.artist}`,
          item.artist,
        ]);
        if (match) {
          actions.playDownloaded(match);
          this.notify('Playing offline', match.title);
        } else {
          this.notify('Voice assistant', `I could not find "${command.query}".`);
          this.say('I could not find that.');
        }
        return;
      }
      case 'playDownloads': {
        const downloads = this.completedDownloads();
        const first = downloads[0];
        if (first) {
          actions.playDownloaded(first);
        } else {
          this.say('You have no downloads yet.');
        }
        return;
      }
      case 'playDownloadedPlaylist': {
        const libraries = await this.savedLibraries();
        const library = bestMatch(command.query, libraries, (lib) => [lib.title]);
        const downloads = this.completedDownloads();
        const byId = new Map(downloads.map((item) => [item.videoId, item]));
        const scope = library ? library.videoIds.filter((id) => byId.has(id)) : [];
        const first = scope[0] ? byId.get(scope[0]) : undefined;
        if (library && first) {
          actions.playDownloaded(first, scope);
          this.notify('Playing offline', library.title);
          return;
        }
        if (!offline) {
          const title = await api.invoke('voice:play-search', { query: command.query, kind: 'playlist' });
          if (title) {
            this.notify('Playing', title);
            return;
          }
        }
        this.notify('Voice assistant', `No playlist matches "${command.query}".`);
        this.say('I could not find that playlist in your downloads.');
        return;
      }
      case 'openHome':
        router.go('home');
        return;
      case 'openExplore':
        router.go('explore');
        return;
      case 'openLibrary':
        router.go('library');
        return;
      case 'openLiked':
        router.go('liked');
        return;
      case 'openPlaylists':
        router.go('playlists');
        return;
      case 'openDownloads':
        router.openDownloads();
        return;
      case 'openSettings':
        router.openSettings();
        return;
      case 'openQueue':
        store.dispatch({ type: 'queue-open', open: true });
        return;
      case 'openSearch':
        this.ctx.focusSearch();
        return;
    }
  }
}
