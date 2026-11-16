import { isResolvedTheme } from '../shared/settings';
import type {
  DownloadItem,
  PaletteName,
  SavedLibrary,
  VoiceCommandEvent,
  VoiceConfigPatch,
  VoiceConfigView,
  VoiceStatus,
} from '../shared/types';
import { normalizeSpeech, similarity } from '../shared/voice-intent';
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
  private speechContext: AudioContext | null = null;
  private speechSource: AudioBufferSourceNode | null = null;
  private speechToken = 0;

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
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      };
      if (wanted !== 'default' && wanted !== '') {
        constraints.deviceId = { exact: wanted };
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

  private onAudio(samples: Float32Array): void {
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
    this.yes.play().catch(() => undefined);
  }

  private say(text: string): void {
    const trimmed = text.trim();
    if (trimmed === '') {
      return;
    }
    const token = ++this.speechToken;
    this.ctx.api
      .invoke('voice:speak', trimmed)
      .then((audio) => {
        if (token !== this.speechToken) {
          return;
        }
        if (audio && audio.samples.length > 0) {
          this.playSpeech(audio.samples, audio.sampleRate);
        } else {
          this.systemSay(trimmed);
        }
      })
      .catch(() => {
        this.systemSay(trimmed);
      });
  }

  private playSpeech(samples: Float32Array, sampleRate: number): void {
    this.speechSource?.stop();
    this.speechContext ??= new AudioContext();
    const context = this.speechContext;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(Float32Array.from(samples), 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.ctx.actions.duckOffline(true);
    source.addEventListener('ended', () => {
      if (this.speechSource === source) {
        this.speechSource = null;
        this.ctx.actions.duckOffline(false);
      }
    });
    this.speechSource = source;
    void context.resume().then(() => {
      source.start();
    });
  }

  private systemSay(text: string): void {
    if (!('speechSynthesis' in window)) {
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith('en'));
    const preferred = voices.find((voice) =>
      /samantha|ava|allison|zoe|susan|serena|female/i.test(voice.name),
    );
    if (preferred ?? voices[0]) {
      utterance.voice = preferred ?? voices[0] ?? null;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  async downloadNaturalVoice(): Promise<void> {
    this.config = await this.ctx.api.invoke('voice:download-natural', null);
    this.emit();
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
    const { actions, store, router, api } = this.ctx;
    const player = store.getState().player;
    if (command.action === 'none') {
      if (command.source === 'blocked') {
        this.notify('Voice assistant', command.reply);
        this.say(command.reply);
      } else if (command.source === 'rejected') {
        this.notify('Voice assistant', 'That did not sound like your voice.');
      } else if (command.source === 'empty') {
        this.notify('Voice assistant', 'I did not hear a command.');
      } else {
        const heard = command.transcript === '' ? '' : ` "${command.transcript}"`;
        this.notify('Voice assistant', `Sorry, I did not understand${heard}.`);
        this.say(command.reply || 'Sorry, I did not catch that.');
      }
      return;
    }
    this.notify('Voice assistant', command.transcript === '' ? command.action : command.transcript);
    if (command.reply !== '') {
      this.say(command.reply);
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
        } else {
          this.notify('Voice assistant', `No downloaded playlist matches "${command.query}".`);
          this.say('I could not find that playlist in your downloads.');
        }
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
