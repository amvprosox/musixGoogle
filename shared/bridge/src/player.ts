import { AD_PLAYBACK_RATE_VALUE, PROGRESS_INTERVAL_MS, STATE_HEARTBEAT_MS } from './timing';
import type { BridgeState, LikeStatus, QueueEntry, RepeatMode } from './contract';
import { EMPTY_STATE } from './contract';
import { BAR_SELECTORS, clickFirst, clip, DOC_SEL, queryFirst, SEL, textOfElement } from './dom';
import { readPageConfig } from './innertube';
import { bestThumbnail, parseClock, upgradeArtwork } from './parse';
import {
  bufferedAhead,
  diffState,
  isAllowedImageUrl,
  isProgressOnly,
  playlistIdFromUrl,
  queueEquals,
  roundTenth,
  videoIdFromUrl,
} from './state';

const MAX_TEXT = 2000;
const MAX_URL = 4096;

export interface PlayerApi {
  getVolume?: () => number;
  setVolume?: (volume: number) => void;
  isMuted?: () => boolean;
  mute?: () => void;
  unMute?: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
  nextVideo?: () => void;
  previousVideo?: () => void;
}

export interface ObserverSink {
  state: (state: BridgeState) => void;
  queue: (items: QueueEntry[]) => void;
  adStart: () => void;
  adEnd: () => void;
  signedIn: (avatarUrl: string) => void;
  signedOut: () => void;
}

interface MetaSnapshot {
  title: string;
  artist: string;
  album: string;
  artwork: string;
}

function parseSize(sizes: string): number {
  const match = /(\d+)x(\d+)/.exec(sizes);
  if (!match) {
    return 0;
  }
  return Number.parseInt(match[1] ?? '0', 10) * Number.parseInt(match[2] ?? '0', 10);
}

function readMetadata(): MetaSnapshot | null {
  try {
    const metadata = navigator.mediaSession.metadata;
    if (!metadata) {
      return null;
    }
    let best = '';
    let bestSize = -1;
    for (const image of metadata.artwork) {
      const size = parseSize(image.sizes ?? '');
      if (size > bestSize) {
        bestSize = size;
        best = image.src;
      }
    }
    return { title: metadata.title, artist: metadata.artist, album: metadata.album, artwork: best };
  } catch {
    return null;
  }
}

export class PlayerObserver {
  private bar: Element | null = null;
  private barObserver: MutationObserver | null = null;
  private video: HTMLVideoElement | null = null;
  private videoAbort: AbortController | null = null;
  private queueRoot: Element | null = null;
  private queueObserver: MutationObserver | null = null;
  private queueTimer: number | null = null;
  private lastSent: BridgeState | null = null;
  private lastProgressAt = 0;
  private lastSentAt = 0;
  private progressTimer: number | null = null;
  private updateScheduled = false;
  private lastQueue: QueueEntry[] = [];
  private signedIn: boolean | null = null;
  private lastAvatar = '';
  private waiting = false;
  private adSkip = true;
  private adActive = false;
  private adReported = false;
  private adSaved: { muted: boolean; rate: number } | null = null;
  private duckLevel = 1;
  private duckBase: number | null = null;
  private knownPlaylistId = '';
  private watchdog: number | null = null;

  constructor(
    private readonly doc: Document,
    private readonly win: Window,
    private readonly sink: ObserverSink,
  ) {}

  start(): void {
    this.tick();
    this.watchdog = this.win.setInterval(() => {
      this.tick();
    }, PROGRESS_INTERVAL_MS * 4);
  }

  stop(): void {
    if (this.watchdog !== null) {
      this.win.clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.barObserver?.disconnect();
    this.queueObserver?.disconnect();
    this.videoAbort?.abort();
  }

  isReady(): boolean {
    return queryFirst(this.doc, DOC_SEL.app) !== null && this.findBar() !== null;
  }

  setAdSkip(enabled: boolean): void {
    this.adSkip = enabled;
    if (!enabled) {
      this.restoreAfterAd();
    }
    this.scheduleUpdate();
  }

  setDuck(level: number): void {
    const video = this.video;
    this.duckLevel = level;
    if (!video) {
      return;
    }
    if (level >= 1) {
      if (this.duckBase !== null) {
        video.volume = this.duckBase;
      }
      this.duckBase = null;
      return;
    }
    if (this.duckBase === null) {
      this.duckBase = video.volume;
    }
    video.volume = Math.max(0, Math.min(1, this.duckBase * level));
  }

  rememberPlaylist(playlistId: string | null): void {
    this.knownPlaylistId = playlistId ?? '';
  }

  tick(): void {
    this.attachBar();
    this.attachVideo();
    this.attachQueue();
    this.checkAccount();
    this.scheduleUpdate();
  }

  current(): BridgeState {
    return this.lastSent ?? this.readState();
  }

  findBar(): Element | null {
    return queryFirst(this.doc, BAR_SELECTORS);
  }

  player(): (Element & PlayerApi) | null {
    return queryFirst(this.doc, DOC_SEL.moviePlayer);
  }

  videoElement(): HTMLVideoElement | null {
    return this.video;
  }

  queueElements(): HTMLElement[] {
    const root = this.queueRoot ?? queryFirst(this.doc, DOC_SEL.queueRoot);
    if (!root) {
      return [];
    }
    return Array.from(root.querySelectorAll(DOC_SEL.queueItem)).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.closest('#counterpart-renderer') === null,
    );
  }

  private attachBar(): void {
    const bar = this.findBar();
    if (bar === this.bar) {
      return;
    }
    this.barObserver?.disconnect();
    this.barObserver = null;
    this.bar = bar;
    if (!bar) {
      return;
    }
    this.barObserver = new MutationObserver(() => {
      this.scheduleUpdate();
    });
    this.barObserver.observe(bar, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'like-status',
        'repeat-mode',
        'shuffle-on',
        'is-advertisement',
        'src',
        'title',
        'aria-pressed',
        'aria-valuenow',
      ],
    });
  }

  private attachVideo(): void {
    const el = queryFirst(this.doc, DOC_SEL.video);
    const video = el instanceof HTMLVideoElement ? el : null;
    if (video === this.video) {
      return;
    }
    this.videoAbort?.abort();
    this.videoAbort = null;
    this.video = video;
    this.adActive = false;
    this.adSaved = null;
    this.duckBase = null;
    if (!video) {
      return;
    }
    const controller = new AbortController();
    this.videoAbort = controller;
    const update = (): void => {
      this.scheduleUpdate();
    };
    for (const name of [
      'timeupdate',
      'play',
      'pause',
      'volumechange',
      'ended',
      'durationchange',
      'loadedmetadata',
      'ratechange',
      'emptied',
      'seeked',
      'progress',
    ]) {
      video.addEventListener(name, update, { signal: controller.signal, passive: true });
    }
    video.addEventListener(
      'waiting',
      () => {
        this.waiting = true;
        this.scheduleUpdate();
      },
      { signal: controller.signal, passive: true },
    );
    for (const name of ['playing', 'canplay', 'canplaythrough']) {
      video.addEventListener(
        name,
        () => {
          this.waiting = false;
          this.scheduleUpdate();
        },
        { signal: controller.signal, passive: true },
      );
    }
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (this.duckLevel < 1) {
          this.duckBase = null;
          this.setDuck(this.duckLevel);
        }
      },
      { signal: controller.signal, passive: true },
    );
  }

  private attachQueue(): void {
    const root = queryFirst(this.doc, DOC_SEL.queueRoot);
    if (root === this.queueRoot) {
      return;
    }
    this.queueObserver?.disconnect();
    this.queueObserver = null;
    this.queueRoot = root;
    if (!root) {
      this.publishQueue([]);
      return;
    }
    this.queueObserver = new MutationObserver(() => {
      this.scheduleQueue();
    });
    this.queueObserver.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['selected', 'src', 'play-button-state'],
    });
    this.scheduleQueue();
  }

  private scheduleQueue(): void {
    if (this.queueTimer !== null) {
      this.win.clearTimeout(this.queueTimer);
    }
    this.queueTimer = this.win.setTimeout(() => {
      this.queueTimer = null;
      this.publishQueue(this.readQueue());
    }, 150);
  }

  readQueue(): QueueEntry[] {
    return this.queueElements()
      .slice(0, 2000)
      .map((el, index) => {
        const data = (el as unknown as { data?: Record<string, unknown> }).data;
        const dataVideoId = data && typeof data.videoId === 'string' ? data.videoId : '';
        const attrVideoId = el.getAttribute('data-video-id') ?? '';
        const img = queryFirst(el, DOC_SEL.queueThumb);
        const src = img instanceof HTMLImageElement ? img.src : '';
        const dataArt = data ? bestThumbnail(data.thumbnail, 544) : '';
        const art = dataArt !== '' ? dataArt : isAllowedImageUrl(src) ? upgradeArtwork(src, 544) : '';
        return {
          index,
          videoId: clip(dataVideoId || attrVideoId, 64),
          title: clip(textOfElement(el, DOC_SEL.queueTitle), MAX_TEXT),
          artist: clip(textOfElement(el, DOC_SEL.queueArtist), MAX_TEXT),
          artworkUrl: clip(art, MAX_URL),
          durationSec: parseClock(textOfElement(el, DOC_SEL.queueDuration)) ?? 0,
          isCurrent: el.hasAttribute('selected'),
        };
      });
  }

  private publishQueue(queue: QueueEntry[]): void {
    if (queueEquals(queue, this.lastQueue)) {
      return;
    }
    this.lastQueue = queue;
    this.sink.queue(queue);
  }

  private checkAccount(): void {
    const config = readPageConfig(this.win);
    const settings = queryFirst(this.doc, DOC_SEL.settingsButton);
    const signInLink = queryFirst(this.doc, DOC_SEL.signInLink);
    const signedIn = config ? config.loggedIn : settings !== null && signInLink === null;
    const avatar = queryFirst(this.doc, DOC_SEL.avatar);
    const avatarUrl =
      avatar instanceof HTMLImageElement && isAllowedImageUrl(avatar.src) ? clip(avatar.src, MAX_URL) : '';
    if (signedIn === this.signedIn && avatarUrl === this.lastAvatar) {
      return;
    }
    const changedState = signedIn !== this.signedIn;
    this.signedIn = signedIn;
    this.lastAvatar = avatarUrl;
    if (signedIn) {
      this.sink.signedIn(avatarUrl);
    } else if (changedState) {
      this.sink.signedOut();
    }
    this.scheduleUpdate();
  }

  isAdShowing(): boolean {
    if (this.bar && this.bar.hasAttribute('is-advertisement')) {
      return true;
    }
    const player = this.player();
    if (player && player.classList.contains('ad-showing')) {
      return true;
    }
    return queryFirst(player, DOC_SEL.adIndicators) !== null;
  }

  private handleAd(isAd: boolean): void {
    if (isAd && !this.adReported) {
      this.adReported = true;
      this.sink.adStart();
    }
    if (!isAd && this.adReported) {
      this.adReported = false;
      this.sink.adEnd();
    }
    if (!isAd || !this.adSkip) {
      this.restoreAfterAd();
      return;
    }
    const video = this.video;
    if (!video) {
      return;
    }
    if (!this.adActive) {
      this.adActive = true;
      this.adSaved = { muted: video.muted, rate: video.playbackRate };
    }
    if (!video.muted) {
      video.muted = true;
    }
    try {
      if (video.playbackRate !== AD_PLAYBACK_RATE_VALUE) {
        video.playbackRate = AD_PLAYBACK_RATE_VALUE;
      }
    } catch {
      this.adSaved = this.adSaved ?? { muted: video.muted, rate: 1 };
    }
    const player = this.player();
    if (clickFirst(player ?? this.doc, DOC_SEL.skipButtons)) {
      return;
    }
    if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.25) {
      video.currentTime = video.duration;
    }
  }

  private restoreAfterAd(): void {
    if (!this.adActive) {
      return;
    }
    const video = this.video;
    const saved = this.adSaved;
    this.adActive = false;
    this.adSaved = null;
    if (!video || !saved) {
      return;
    }
    video.muted = saved.muted;
    try {
      video.playbackRate = saved.rate;
    } catch {
      video.playbackRate = 1;
    }
  }

  private readVolume(): { volume: number; muted: boolean } {
    const player = this.player();
    if (player && typeof player.getVolume === 'function' && typeof player.isMuted === 'function') {
      const volume = player.getVolume();
      if (Number.isFinite(volume)) {
        return { volume: Math.min(1, Math.max(0, volume / 100)), muted: player.isMuted() };
      }
    }
    const video = this.video;
    if (video) {
      const muted = this.adActive && this.adSaved ? this.adSaved.muted : video.muted;
      const base = this.duckBase ?? video.volume;
      return { volume: Math.min(1, Math.max(0, base)), muted };
    }
    return { volume: 1, muted: false };
  }

  private readVideoId(): string {
    const link = queryFirst(this.doc, DOC_SEL.titleLink);
    if (link instanceof HTMLAnchorElement) {
      const fromLink = videoIdFromUrl(link.href);
      if (fromLink !== '') {
        return fromLink;
      }
    }
    return videoIdFromUrl(this.win.location.href);
  }

  private readPlaylistId(): string {
    const link = queryFirst(this.doc, DOC_SEL.titleLink);
    const fromLink = link instanceof HTMLAnchorElement ? playlistIdFromUrl(link.href) : '';
    if (fromLink !== '') {
      return fromLink;
    }
    const fromUrl = playlistIdFromUrl(this.win.location.href);
    return fromUrl !== '' ? fromUrl : this.knownPlaylistId;
  }

  private readDuration(bar: Element, video: HTMLVideoElement | null): number {
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      return video.duration;
    }
    const total = textOfElement(bar, SEL.timeInfo).split('/')[1];
    return total ? (parseClock(total) ?? 0) : 0;
  }

  readState(): BridgeState {
    const bar = this.bar ?? this.findBar();
    const video = this.video;
    const isSignedIn = this.signedIn === true;
    if (!bar) {
      return { ...EMPTY_STATE, isSignedIn };
    }
    const isAd = this.isAdShowing();
    const meta = readMetadata();
    const byline = textOfElement(bar, SEL.byline)
      .split('•')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    const title = meta && meta.title !== '' ? meta.title : textOfElement(bar, SEL.title);
    const artist = meta && meta.artist !== '' ? meta.artist : (byline[0] ?? '');
    const album = meta && meta.album !== '' ? meta.album : byline.length > 2 ? (byline[1] ?? '') : '';
    const artImg = queryFirst(bar, SEL.art);
    const barArt = artImg instanceof HTMLImageElement ? artImg.src : '';
    const metaArt = meta && isAllowedImageUrl(meta.artwork) ? meta.artwork : '';
    const rawArt = metaArt !== '' ? metaArt : isAllowedImageUrl(barArt) ? barArt : '';
    const artworkUrl = rawArt !== '' ? upgradeArtwork(rawArt, 1200) : '';
    const durationSec = this.readDuration(bar, video);
    const positionSec = video
      ? Math.min(video.currentTime, durationSec > 0 ? durationSec : video.currentTime)
      : 0;
    const isPlaying = video ? !video.paused && !video.ended : false;
    const isBuffering = video ? isPlaying && (this.waiting || video.readyState < 3) : false;
    const { volume, muted } = this.readVolume();
    const likeRenderer = queryFirst(bar, SEL.likeRenderer);
    const likeAttr = likeRenderer ? likeRenderer.getAttribute('like-status') : null;
    const likeStatus: LikeStatus = likeAttr === 'LIKE' || likeAttr === 'DISLIKE' ? likeAttr : 'INDIFFERENT';
    const repeatAttr = bar.getAttribute('repeat-mode');
    const repeatMode: RepeatMode = repeatAttr === 'ALL' || repeatAttr === 'ONE' ? repeatAttr : 'NONE';
    return {
      videoId: this.readVideoId(),
      playlistId: this.readPlaylistId(),
      title: clip(title, MAX_TEXT),
      artist: clip(artist, MAX_TEXT),
      album: clip(album, MAX_TEXT),
      artworkUrl: clip(isAllowedImageUrl(artworkUrl) ? artworkUrl : '', MAX_URL),
      durationSec: roundTenth(durationSec),
      positionSec: roundTenth(positionSec),
      bufferedSec: roundTenth(video ? Math.max(positionSec, bufferedAhead(video)) : 0),
      isPlaying: isPlaying && video !== null && video.readyState > 0,
      isBuffering,
      volume: Math.round(volume * 100) / 100,
      isMuted: muted,
      likeStatus,
      shuffle: bar.hasAttribute('shuffle-on'),
      repeatMode,
      isAd,
      isSignedIn,
    };
  }

  scheduleUpdate(): void {
    if (this.updateScheduled) {
      return;
    }
    this.updateScheduled = true;
    queueMicrotask(() => {
      this.updateScheduled = false;
      this.update();
    });
  }

  private update(): void {
    const state = this.readState();
    this.handleAd(state.isAd);
    const changed = diffState(this.lastSent, state);
    const now = Date.now();
    if (changed.length === 0) {
      if (now - this.lastSentAt < STATE_HEARTBEAT_MS) {
        return;
      }
      this.lastSentAt = now;
      this.sink.state(state);
      return;
    }
    if (isProgressOnly(changed)) {
      const wait = PROGRESS_INTERVAL_MS - (now - this.lastProgressAt);
      if (wait > 0) {
        if (this.progressTimer === null) {
          this.progressTimer = this.win.setTimeout(() => {
            this.progressTimer = null;
            this.scheduleUpdate();
          }, wait);
        }
        return;
      }
    }
    if (this.progressTimer !== null) {
      this.win.clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
    this.lastProgressAt = now;
    this.lastSentAt = now;
    this.lastSent = state;
    this.sink.state(state);
  }

  forceState(): void {
    this.lastSent = null;
    this.scheduleUpdate();
  }
}
