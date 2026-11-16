export const VOICE_ACTIONS = [
  'pause',
  'resume',
  'next',
  'previous',
  'shuffleOn',
  'shuffleOff',
  'repeat',
  'repeatOne',
  'repeatOff',
  'like',
  'dislike',
  'volumeUp',
  'volumeDown',
  'mute',
  'unmute',
  'seekForward',
  'seekBack',
  'restart',
  'whatsPlaying',
  'showLyrics',
  'hideLyrics',
  'downloadSong',
  'setTheme',
  'search',
  'play',
  'playDownloads',
  'playDownloadedPlaylist',
  'openHome',
  'openExplore',
  'openLibrary',
  'openLiked',
  'openPlaylists',
  'openDownloads',
  'openSettings',
  'openQueue',
  'openSearch',
] as const;

export type VoiceAction = (typeof VOICE_ACTIONS)[number];

export interface VoiceCommand {
  action: VoiceAction;
  phrases: string[];
}

export interface VoiceIntent {
  action: VoiceAction;
  query: string;
  score: number;
}

export const VOICE_ACTION_LABELS: Readonly<Record<VoiceAction, string>> = {
  pause: 'Pause',
  resume: 'Resume',
  next: 'Next song',
  previous: 'Previous song',
  shuffleOn: 'Shuffle on',
  shuffleOff: 'Shuffle off',
  repeat: 'Repeat all',
  repeatOne: 'Repeat this song',
  repeatOff: 'Repeat off',
  like: 'Like song',
  dislike: 'Dislike song',
  volumeUp: 'Volume up',
  volumeDown: 'Volume down',
  mute: 'Mute',
  unmute: 'Unmute',
  seekForward: 'Forward 10 seconds',
  seekBack: 'Back 10 seconds',
  restart: 'Restart song',
  whatsPlaying: "What's playing",
  showLyrics: 'Show lyrics',
  hideLyrics: 'Hide lyrics',
  downloadSong: 'Download this song',
  setTheme: 'Change theme',
  search: 'Search',
  play: 'Play something',
  playDownloads: 'Play downloads',
  playDownloadedPlaylist: 'Play a downloaded playlist',
  openHome: 'Open Home',
  openExplore: 'Open Explore',
  openLibrary: 'Open Library',
  openLiked: 'Open Liked songs',
  openPlaylists: 'Open Playlists',
  openDownloads: 'Open Downloads',
  openSettings: 'Open Settings',
  openQueue: 'Open queue',
  openSearch: 'Open Search',
};

export const DEFAULT_VOICE_COMMANDS: readonly VoiceCommand[] = [
  { action: 'pause', phrases: ['pause', 'pause the music', 'stop', 'stop the music', 'stop playing'] },
  { action: 'resume', phrases: ['resume', 'play', 'continue', 'keep playing', 'play the music'] },
  {
    action: 'next',
    phrases: ['next', 'next song', 'skip', 'skip this', 'skip this song', 'play the next song'],
  },
  {
    action: 'previous',
    phrases: ['previous', 'previous song', 'go back', 'last song', 'play the previous song', 'back'],
  },
  { action: 'shuffleOn', phrases: ['shuffle', 'shuffle on', 'turn on shuffle', 'shuffle the music'] },
  { action: 'shuffleOff', phrases: ['shuffle off', 'turn off shuffle', 'stop shuffle', 'no shuffle'] },
  { action: 'repeat', phrases: ['repeat', 'repeat all', 'turn on repeat', 'loop', 'loop everything'] },
  {
    action: 'repeatOne',
    phrases: ['repeat this song', 'repeat this', 'repeat one', 'loop this song', 'on repeat'],
  },
  { action: 'repeatOff', phrases: ['repeat off', 'turn off repeat', 'stop repeating', 'no repeat'] },
  { action: 'like', phrases: ['like', 'like this', 'like this song', 'i like this song'] },
  { action: 'dislike', phrases: ['dislike', 'dislike this', 'i dont like this', 'thumbs down'] },
  { action: 'volumeUp', phrases: ['volume up', 'louder', 'turn it up', 'turn up the volume'] },
  { action: 'volumeDown', phrases: ['volume down', 'quieter', 'turn it down', 'turn down the volume'] },
  { action: 'mute', phrases: ['mute', 'mute the music', 'silence'] },
  { action: 'unmute', phrases: ['unmute', 'unmute the music', 'sound on'] },
  { action: 'seekForward', phrases: ['forward', 'skip forward', 'fast forward', 'forward ten seconds'] },
  { action: 'seekBack', phrases: ['rewind', 'go back ten seconds', 'skip back', 'back ten seconds'] },
  { action: 'restart', phrases: ['restart', 'restart the song', 'play from the start', 'start over'] },
  {
    action: 'whatsPlaying',
    phrases: [
      'whats playing',
      'what song is this',
      'what is this song',
      'who is singing',
      'what am i listening to',
    ],
  },
  { action: 'showLyrics', phrases: ['show lyrics', 'lyrics', 'open lyrics', 'show the lyrics'] },
  { action: 'hideLyrics', phrases: ['hide lyrics', 'close lyrics', 'hide the lyrics'] },
  {
    action: 'downloadSong',
    phrases: ['download this song', 'download this', 'save this song offline', 'download'],
  },
  {
    action: 'setTheme',
    phrases: [
      'switch to {query} theme',
      'change theme to {query}',
      'use {query} theme',
      '{query} mode',
      'theme {query}',
    ],
  },
  { action: 'search', phrases: ['search {query}', 'search for {query}', 'find {query}', 'look for {query}'] },
  {
    action: 'playDownloadedPlaylist',
    phrases: [
      'play my downloaded playlist {query}',
      'play downloaded playlist {query}',
      'play my downloaded {query}',
      'play offline playlist {query}',
    ],
  },
  {
    action: 'playDownloads',
    phrases: [
      'play my downloads',
      'play downloads',
      'play offline',
      'play my offline music',
      'play downloaded songs',
    ],
  },
  {
    action: 'play',
    phrases: ['play {query}', 'put on {query}', 'i want to hear {query}', 'listen to {query}'],
  },
  { action: 'openHome', phrases: ['open home', 'go home', 'home'] },
  { action: 'openExplore', phrases: ['open explore', 'explore', 'go to explore'] },
  { action: 'openLibrary', phrases: ['open library', 'open my library', 'library'] },
  {
    action: 'openLiked',
    phrases: ['open liked songs', 'open my liked songs', 'liked songs', 'open liked music'],
  },
  { action: 'openPlaylists', phrases: ['open playlists', 'open my playlists', 'my playlists'] },
  { action: 'openDownloads', phrases: ['open downloads', 'open my downloads', 'show downloads'] },
  { action: 'openSettings', phrases: ['open settings', 'settings', 'show settings'] },
  { action: 'openQueue', phrases: ['open queue', 'show queue', 'whats next', 'show up next'] },
  { action: 'openSearch', phrases: ['open search', 'go to search'] },
];

export const WAKE_WORD = 'prosecs';
const WAKE_VARIANTS = [
  'prosecs',
  'pro secs',
  'pro sex',
  'prosex',
  'pro seks',
  'proseks',
  'pro sec',
  'prossex',
  'pros ex',
  'pro six',
];
const WAKE_DENY = ['process', 'processes', 'processing', 'prospect', 'prospects'];
const MATCH_THRESHOLD = 0.72;
const STRONG_MATCH = 0.8;
const TAIL_PENALTY = 0.9;
const SLOT = '{query}';

export function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function similarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((cur[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return 1 - (prev[b.length] ?? 0) / Math.max(a.length, b.length);
}

export function stripWakeWord(text: string): { heard: boolean; rest: string } {
  const words = normalizeSpeech(text)
    .split(' ')
    .filter((word) => word !== '');
  if (WAKE_DENY.includes(words[0] ?? '')) {
    return { heard: false, rest: words.join(' ') };
  }
  for (const take of [2, 1]) {
    if (words.length < take) {
      continue;
    }
    const head = words.slice(0, take).join(' ');
    const best = Math.max(...WAKE_VARIANTS.map((variant) => similarity(head, variant)));
    if (best >= 0.7) {
      return { heard: true, rest: words.slice(take).join(' ') };
    }
  }
  return { heard: false, rest: words.join(' ') };
}

function fixedWordCount(phrase: string): number {
  return phrase.split(' ').filter((word) => word !== '' && word !== SLOT).length;
}

function matchSlotPhrase(words: readonly string[], phrase: string): { score: number; query: string } | null {
  const [prefixText = '', suffixText = ''] = phrase.split(SLOT).map((part) => part.trim());
  const prefixWords = prefixText === '' ? [] : prefixText.split(' ');
  const suffixWords = suffixText === '' ? [] : suffixText.split(' ');
  let best: { score: number; query: string } | null = null;
  for (const delta of [0, -1, 1]) {
    const take = prefixWords.length + delta;
    if (take < 0 || (prefixWords.length > 0 && take === 0) || take >= words.length) {
      continue;
    }
    const head = words.slice(0, take).join(' ');
    const prefixScore = prefixWords.length === 0 ? 1 : similarity(head, prefixText);
    let rest = words.slice(take);
    let suffixScore = 1;
    if (suffixWords.length > 0) {
      if (rest.length <= suffixWords.length) {
        continue;
      }
      suffixScore = similarity(rest.slice(rest.length - suffixWords.length).join(' '), suffixText);
      rest = rest.slice(0, rest.length - suffixWords.length);
    }
    const query = rest.join(' ').trim();
    if (query === '') {
      continue;
    }
    const score = Math.min(prefixScore, suffixScore);
    if (!best || score > best.score) {
      best = { score, query };
    }
  }
  return best;
}

export function matchIntent(
  text: string,
  commands: readonly VoiceCommand[] = DEFAULT_VOICE_COMMANDS,
): VoiceIntent | null {
  const normalized = normalizeSpeech(text);
  if (normalized === '') {
    return null;
  }
  const words = normalized.split(' ');
  const candidates: { intent: VoiceIntent; weight: number }[] = [];
  for (const command of commands) {
    for (const raw of command.phrases) {
      const phrase = normalizeSpeech(raw.replace(SLOT, ' qqslotqq ')).replace('qqslotqq', SLOT);
      if (phrase === '') {
        continue;
      }
      const weight = fixedWordCount(phrase);
      if (phrase.includes(SLOT)) {
        const slot = matchSlotPhrase(words, phrase);
        if (slot && slot.score >= MATCH_THRESHOLD) {
          candidates.push({
            intent: { action: command.action, query: slot.query, score: slot.score },
            weight,
          });
        }
        continue;
      }
      let score = similarity(normalized, phrase);
      const phraseWords = phrase.split(' ').length;
      for (const extra of [1, 2]) {
        if (words.length === phraseWords + extra) {
          score = Math.max(score, similarity(words.slice(extra).join(' '), phrase) * TAIL_PENALTY);
        }
      }
      if (score >= MATCH_THRESHOLD) {
        candidates.push({ intent: { action: command.action, query: '', score }, weight });
      }
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  const strong = candidates.filter((candidate) => candidate.intent.score >= STRONG_MATCH);
  const pool = strong.length > 0 ? strong : candidates;
  pool.sort((a, b) =>
    strong.length > 0
      ? b.weight - a.weight || b.intent.score - a.intent.score
      : b.intent.score - a.intent.score || b.weight - a.weight,
  );
  return pool[0]?.intent ?? null;
}

export function isVoiceAction(value: unknown): value is VoiceAction {
  return typeof value === 'string' && (VOICE_ACTIONS as readonly string[]).includes(value);
}

export function sanitizeVoiceCommands(value: unknown): VoiceCommand[] {
  if (!Array.isArray(value)) {
    return DEFAULT_VOICE_COMMANDS.map((command) => ({ ...command, phrases: [...command.phrases] }));
  }
  const byAction = new Map<VoiceAction, string[]>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    if (!isVoiceAction(record.action) || !Array.isArray(record.phrases)) {
      continue;
    }
    const phrases = record.phrases
      .filter((phrase): phrase is string => typeof phrase === 'string')
      .map((phrase) => phrase.trim().slice(0, 80))
      .filter((phrase) => phrase !== '')
      .slice(0, 12);
    byAction.set(record.action, phrases);
  }
  return DEFAULT_VOICE_COMMANDS.map((command) => ({
    action: command.action,
    phrases: byAction.get(command.action) ?? [...command.phrases],
  }));
}

const OUT_OF_SCOPE = [
  'source code',
  'your code',
  'the code',
  'codebase',
  'code base',
  'programming',
  'developer mode',
  'developer',
  'system prompt',
  'your prompt',
  'your instructions',
  'ignore previous',
  'ignore your',
  'ignore all',
  'forget your',
  'jailbreak',
  'api key',
  'password',
  'token',
  'terminal',
  'command line',
  'run a command',
  'shell command',
  'execute',
  'delete files',
  'internal',
  'how are you built',
  'how were you made',
  'what model are you',
  'which model',
  'hack',
  'exploit',
];

export function isOutOfScope(text: string): boolean {
  const normalized = ` ${normalizeSpeech(text)} `;
  return OUT_OF_SCOPE.some((phrase) => normalized.includes(` ${phrase} `));
}

export const OUT_OF_SCOPE_REPLY = 'I can only control Musix music playback.';

export function safeReply(reply: string): string {
  const trimmed = reply.trim();
  if (
    trimmed === '' ||
    trimmed.length > 160 ||
    /[{}<>`$\\]|https?:/i.test(trimmed) ||
    isOutOfScope(trimmed)
  ) {
    return '';
  }
  return trimmed;
}
