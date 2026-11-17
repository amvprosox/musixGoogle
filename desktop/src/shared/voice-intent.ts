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
  'seekTo',
  'setVolume',
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
  seekTo: 'Go to a time (e.g. 1:30)',
  setVolume: 'Set volume (e.g. 50%)',
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
  {
    action: 'pause',
    phrases: [
      'pause',
      'pause the music',
      'stop',
      'stop the music',
      'stop playing',
      'ihinto',
      'tigil',
      'pahinto',
      'itigil ang kanta',
    ],
  },
  {
    action: 'resume',
    phrases: [
      'resume',
      'play',
      'continue',
      'keep playing',
      'play the music',
      'ituloy',
      'tuloy',
      'ituloy ang kanta',
    ],
  },
  {
    action: 'next',
    phrases: [
      'next',
      'next song',
      'skip',
      'skip this',
      'skip this song',
      'play the next song',
      'susunod',
      'susunod na kanta',
      'lipat',
    ],
  },
  {
    action: 'previous',
    phrases: [
      'previous',
      'previous song',
      'go back',
      'last song',
      'play the previous song',
      'back',
      'balik',
      'bumalik',
      'nakaraang kanta',
    ],
  },
  {
    action: 'shuffleOn',
    phrases: ['shuffle', 'shuffle on', 'turn on shuffle', 'shuffle the music', 'i shuffle'],
  },
  { action: 'shuffleOff', phrases: ['shuffle off', 'turn off shuffle', 'stop shuffle', 'no shuffle'] },
  { action: 'repeat', phrases: ['repeat', 'repeat all', 'turn on repeat', 'loop', 'loop everything'] },
  {
    action: 'repeatOne',
    phrases: ['repeat this song', 'repeat this', 'repeat one', 'loop this song', 'on repeat'],
  },
  { action: 'repeatOff', phrases: ['repeat off', 'turn off repeat', 'stop repeating', 'no repeat'] },
  { action: 'like', phrases: ['like', 'like this', 'like this song', 'i like this song'] },
  { action: 'dislike', phrases: ['dislike', 'dislike this', 'i dont like this', 'thumbs down'] },
  {
    action: 'volumeUp',
    phrases: ['volume up', 'louder', 'turn it up', 'turn up the volume', 'lakasan', 'lakasan mo'],
  },
  {
    action: 'volumeDown',
    phrases: ['volume down', 'quieter', 'turn it down', 'turn down the volume', 'hinaan', 'hinaan mo'],
  },
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
  {
    action: 'showLyrics',
    phrases: ['show lyrics', 'lyrics', 'open lyrics', 'show the lyrics', 'ipakita ang lyrics'],
  },
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
      'tugtugin ang downloads ko',
    ],
  },
  {
    action: 'play',
    phrases: [
      'play {query}',
      'put on {query}',
      'i want to hear {query}',
      'listen to {query}',
      'tugtugin {query}',
      'patugtugin {query}',
      'pakitugtog {query}',
      'i play {query}',
    ],
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

export const WAKE_WORD = 'veru';
const WAKE_VARIANTS = [
  'veru',
  'barrow',
  'burrow',
  'bureau',
  'peru',
  'vairu',
  'bairu',
  'veeru',
  'viru',
  'fero',
  'feru',
  'vero',
  'beru',
  'be ru',
  'veyru',
  'vey ru',
  'biro',
  'bi ro',
  'bero',
  'be ro',
  'berru',
  'biru',
  'vayru',
  'bayru',
  've ru',
  'veroo',
  'beroo',
  'beyru',
  'bey ru',
];
const WAKE_DENY = ['very', 'pero', 'hero', 'zero', 'every', 'vary', 'berry', 'bury', 'borrow'];
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

export function wakeHeadFrom(transcript: string): string | null {
  const words = normalizeSpeech(transcript)
    .split(' ')
    .filter((word) => word !== '');
  if (words.length === 0 || WAKE_DENY.includes(words[0] ?? '')) {
    return null;
  }
  let best: { head: string; score: number } | null = null;
  for (const take of [1, 2]) {
    if (words.length < take) {
      continue;
    }
    const head = words.slice(0, take).join(' ');
    const score = Math.max(...WAKE_VARIANTS.map((variant) => similarity(head, variant)));
    if (!best || score > best.score) {
      best = { head, score };
    }
  }
  return best && best.score >= 0.4 && best.head.length <= 16 ? best.head : null;
}

const WAKE_GREETINGS = new Set(['hey', 'hi', 'ok', 'okay', 'oi', 'uy', 'yo', 'hello', 'oy']);

/** Any spelling shaped like V-E-R-U: a b/v/f/w sound, a vowel, an r, a vowel. */
function soundsLikeVeru(word: string): boolean {
  if (WAKE_DENY.includes(word) || word.length > 7) {
    return false;
  }
  return /^(v|b|bh|f|w)(e|ee|ei|ey|ai|ay|i|eh)rr?(u|oo|o|ou|uh|ue)h?$/.test(word);
}

export function stripWakeWord(
  text: string,
  extraVariants: readonly string[] = [],
): { heard: boolean; rest: string } {
  const all = normalizeSpeech(text)
    .split(' ')
    .filter((word) => word !== '');
  // "hey Veru", "okay Veru", "uy Veru": skip one greeting word before the name.
  const words = WAKE_GREETINGS.has(all[0] ?? '') && all.length > 1 ? all.slice(1) : all;
  if (WAKE_DENY.includes(words[0] ?? '')) {
    return { heard: false, rest: all.join(' ') };
  }
  for (const take of [2, 1]) {
    if (words.length >= take && soundsLikeVeru(words.slice(0, take).join(''))) {
      return { heard: true, rest: words.slice(take).join(' ') };
    }
  }
  for (const take of [2, 1]) {
    if (words.length < take) {
      continue;
    }
    const head = words.slice(0, take).join(' ');
    const best = Math.max(
      ...[...WAKE_VARIANTS, ...extraVariants].map((variant) => similarity(head, variant)),
    );
    if (best >= 0.7) {
      return { heard: true, rest: words.slice(take).join(' ') };
    }
  }
  return { heard: false, rest: all.join(' ') };
}

/**
 * Finds Veru anywhere in what was heard (people often talk before saying it, or
 * background chatter runs into the command). Mid-sentence matches must sound
 * clearly like Veru, so ordinary words never wake Musix.
 */
export function findWakeWord(
  text: string,
  extraVariants: readonly string[] = [],
): { heard: boolean; rest: string } {
  const start = stripWakeWord(text, extraVariants);
  if (start.heard) {
    return start;
  }
  const words = normalizeSpeech(text)
    .split(' ')
    .filter((word) => word !== '');
  const exact = new Set([...WAKE_VARIANTS.filter((variant) => !variant.includes(' ')), ...extraVariants]);
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i] ?? '';
    if (WAKE_DENY.includes(word)) {
      continue;
    }
    const pair = word + (words[i + 1] ?? '');
    if (i + 1 < words.length && soundsLikeVeru(pair)) {
      return { heard: true, rest: words.slice(i + 2).join(' ') };
    }
    if (exact.has(word) || soundsLikeVeru(word)) {
      return { heard: true, rest: words.slice(i + 1).join(' ') };
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

const STEP_SPLITTER = /\s+(?:and then|and also|after that|and|then|also|plus)\s+/;
const AMBIGUOUS_COLLECTION =
  /^(?:(?:all|every|any|some)\s+(?:of\s+)?)?(?:my\s+|the\s+|a\s+)?(?:own\s+)?(?:play ?lists?|albums?|downloaded play ?lists?)$/;

export interface LocalPlan {
  steps: { action: VoiceAction; query: string }[];
  pending: { action: VoiceAction; query: string }[];
  question: '' | 'playlist';
}

const FILLER_PHRASES =
  /\b(?:can you|could you|would you|will you|i want you to|i want to|i wanna|lets|let us|please|pls|kindly|for me|right now|now|naman|nga|po|pakis?)\b/g;
const FILLER_WORDS = /\b(?:the|a|an|tab|page|screen|section|menu|area|view)\b/g;

function stripFiller(text: string): string {
  return text.replace(FILLER_PHRASES, ' ').replace(FILLER_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  a: 1,
  an: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** Turns "50", "fifty", "twenty five", "one hundred" into a number. */
function readNumber(words: readonly string[], start: number): { value: number; next: number } | null {
  const first = words[start] ?? '';
  if (/^\d+$/.test(first)) {
    return { value: Number(first), next: start + 1 };
  }
  let value = 0;
  let index = start;
  let found = false;
  while (index < words.length) {
    const word = words[index] ?? '';
    if (word === 'hundred' && found) {
      value *= 100;
    } else if (word in NUMBER_WORDS && !(found && (word === 'a' || word === 'an'))) {
      value += NUMBER_WORDS[word] ?? 0;
    } else if (word === 'and' && found) {
      // "one hundred and ten"
    } else {
      break;
    }
    found = true;
    index += 1;
  }
  return found ? { value, next: index } : null;
}

/** Reads a spoken time like "1 30" (from 1:30), "2 minutes 15 seconds", "45 seconds", "half a minute". */
function readDuration(words: readonly string[]): { seconds: number; hasUnit: boolean } | null {
  if (
    words.some(
      (word, i) =>
        word === 'half' &&
        /^(a|an)?$/.test(words[i + 1] ?? '') &&
        words.slice(i).some((w) => w.startsWith('min')),
    )
  ) {
    return { seconds: 30, hasUnit: true };
  }
  for (let i = 0; i < words.length; i += 1) {
    const first = readNumber(words, i);
    if (!first) {
      continue;
    }
    const unit = words[first.next] ?? '';
    const after = words[first.next + 1] ?? '';
    // "1 30" is what "1:30" becomes after punctuation is removed.
    if (/^\d{2}$/.test(unit) && /^\d{1,2}$/.test(words[i] ?? '')) {
      return { seconds: first.value * 60 + Number(unit), hasUnit: true };
    }
    if (/^(minute|minutes|min|mins|minuto)$/.test(unit)) {
      let seconds = first.value * 60;
      let j = first.next + 1;
      if (after === 'and') {
        j += 1;
      }
      const extra = readNumber(words, j);
      if (extra && /^(second|seconds|sec|secs|segundo)?$/.test(words[extra.next] ?? '')) {
        seconds += extra.value;
      }
      return { seconds, hasUnit: true };
    }
    if (/^(second|seconds|sec|secs|segundo)$/.test(unit)) {
      return { seconds: first.value, hasUnit: true };
    }
    return { seconds: first.value, hasUnit: false };
  }
  return null;
}

/**
 * Exact volume and playback position from speech, offline:
 * "set volume to 50 percent", "half volume", "lower the volume by 20",
 * "forward to 1:00", "go to 2 minutes 30", "rewind 15 seconds".
 */
export function matchLevelOrTime(text: string): { action: VoiceAction; query: string } | null {
  const words = normalizeSpeech(text)
    .split(' ')
    .filter((word) => word !== '');
  const joined = ` ${words.join(' ')} `;
  if (/ (volume|vol|lakas|sound|loudness) /.test(joined) || / percent /.test(joined)) {
    if (/ (max|maximum|full|loudest) /.test(joined)) {
      return { action: 'setVolume', query: '100' };
    }
    if (/ half /.test(joined) && !/ \d/.test(joined)) {
      return { action: 'setVolume', query: '50' };
    }
    const byIndex = words.indexOf('by');
    const isNumber = (word: string): boolean =>
      /^\d+$/.test(word) || (word in NUMBER_WORDS && word !== 'a' && word !== 'an');
    // "from 100 to 50": the level after "to" is the one wanted.
    const toIndex = words.lastIndexOf('to');
    const afterTo = toIndex === -1 ? -1 : words.findIndex((word, k) => k > toIndex && isNumber(word));
    const number = readNumber(words, afterTo !== -1 ? afterTo : words.findIndex(isNumber));
    if (number && number.value >= 0 && number.value <= 100) {
      if (byIndex !== -1 && byIndex < number.next) {
        const down = / (lower|decrease|reduce|down|quieter|hinaan) /.test(joined);
        return { action: 'setVolume', query: `${down ? '-' : '+'}${number.value}` };
      }
      return { action: 'setVolume', query: String(number.value) };
    }
    return null;
  }
  const seekWords = / (forward|skip|jump|go|seek|rewind|back|ahead|move|play|start|ilipat|balik) /;
  if (!seekWords.test(joined)) {
    return null;
  }
  const duration = readDuration(words);
  if (!duration) {
    return null;
  }
  const absolute = / (to|at|from|mark) /.test(joined) && !/ by /.test(joined);
  if (absolute) {
    const seconds = duration.hasUnit || duration.seconds > 10 ? duration.seconds : duration.seconds * 60;
    return { action: 'seekTo', query: String(seconds) };
  }
  if (!duration.hasUnit) {
    return null;
  }
  const backwards = / (rewind|back|backward|backwards|balik) /.test(joined);
  return { action: backwards ? 'seekBack' : 'seekForward', query: String(duration.seconds) };
}

export function planLocally(
  text: string,
  commands: readonly VoiceCommand[] = DEFAULT_VOICE_COMMANDS,
): LocalPlan | null {
  const normalized = normalizeSpeech(text);
  if (normalized === '') {
    return null;
  }
  const parts = normalized.split(STEP_SPLITTER).filter((part) => part !== '');
  const matchPart = (part: string): { action: VoiceAction; query: string } | null => {
    const collection = /^(?:play|shuffle|start|put on)\s+(.+)$/.exec(part);
    if (collection?.[1] && AMBIGUOUS_COLLECTION.test(collection[1])) {
      return { action: 'play', query: collection[1] };
    }
    const exact = matchLevelOrTime(part);
    if (exact) {
      return exact;
    }
    const direct = matchIntent(part, commands);
    if (direct) {
      return direct;
    }
    // Retry without polite and filler words ("please open the downloads tab for me").
    const plain = stripFiller(part);
    return plain !== '' && plain !== part ? matchIntent(plain, commands) : null;
  };
  let intents: { action: VoiceAction; query: string }[] | null = null;
  if (parts.length > 1) {
    const matched = parts.map(matchPart);
    if (matched.every((intent) => intent !== null)) {
      intents = matched.map((intent) => ({ action: intent.action, query: intent.query }));
    }
  }
  if (!intents) {
    const whole = matchPart(normalized);
    if (!whole) {
      return null;
    }
    intents = [{ action: whole.action, query: whole.query }];
  }
  const ambiguous = intents.findIndex(
    (step) =>
      (step.action === 'play' || step.action === 'playDownloadedPlaylist') &&
      (AMBIGUOUS_COLLECTION.test(normalizeSpeech(step.query)) || step.query.trim() === ''),
  );
  if (ambiguous === -1) {
    return { steps: intents, pending: [], question: '' };
  }
  return { steps: intents.slice(0, ambiguous), pending: intents.slice(ambiguous + 1), question: 'playlist' };
}

export const VOICE_LANGUAGES: readonly (readonly [string, string])[] = [
  ['en', 'English'],
  ['tl', 'Filipino (Tagalog)'],
  ['zh', 'Chinese (Mandarin, Taiwan, China)'],
  ['ko', 'Korean'],
  ['ja', 'Japanese'],
  ['hi', 'Hindi'],
  ['ur', 'Urdu'],
  ['bn', 'Bengali'],
  ['pa', 'Punjabi'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['mr', 'Marathi'],
  ['id', 'Indonesian'],
  ['ms', 'Malay'],
  ['vi', 'Vietnamese'],
  ['th', 'Thai'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['es', 'Spanish'],
  ['pt', 'Portuguese'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['nl', 'Dutch'],
  ['pl', 'Polish'],
  ['tr', 'Turkish'],
  ['sv', 'Swedish'],
  ['no', 'Norwegian'],
  ['da', 'Danish'],
  ['fi', 'Finnish'],
  ['el', 'Greek'],
  ['cs', 'Czech'],
  ['ro', 'Romanian'],
  ['hu', 'Hungarian'],
  ['ar', 'Arabic'],
  ['fa', 'Persian'],
  ['he', 'Hebrew'],
  ['sw', 'Swahili'],
];

export function isVoiceLanguage(value: unknown): value is string {
  return typeof value === 'string' && VOICE_LANGUAGES.some(([code]) => code === value);
}
