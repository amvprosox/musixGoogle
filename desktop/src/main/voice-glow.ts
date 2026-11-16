import { WebContentsView, type BrowserWindow } from 'electron';
import type { VoiceGlowPart, VoiceGlowPayload } from '../shared/types';
import { paths } from './config';
import { logError } from './log';

const EDGE = 64;
const WAVE_WIDTH = 460;
const WAVE_HEIGHT = 156;
const WAVE_BOTTOM = 112;
const HIDE_DELAY_MS = 380;
const LEVEL_INTERVAL_MS = 50;
const CAPTION_MS = 4200;

interface Part {
  part: VoiceGlowPart;
  view: WebContentsView;
  ready: boolean;
  rect: Electron.Rectangle;
}

export class VoiceGlow {
  private readonly parts: Part[];
  private active = false;
  private thinking = false;
  private level = 0;
  private text = '';
  private caption = '';
  private note = '';
  private laidOut = false;
  private captionTimer: NodeJS.Timeout | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private lastLevelSent = 0;

  constructor(
    private readonly win: BrowserWindow,
    devTools: boolean,
  ) {
    this.parts = (['top', 'bottom', 'left', 'right', 'wave'] as const).map((part) => {
      const view = new WebContentsView({
        webPreferences: {
          preload: paths.overlayPreload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
          backgroundThrottling: false,
          devTools,
        },
      });
      view.setBackgroundColor('#00000000');
      view.setVisible(false);
      win.contentView.addChildView(view);
      const entry: Part = { part, view, ready: false, rect: { x: 0, y: 0, width: 1, height: 1 } };
      view.webContents.on('did-finish-load', () => {
        entry.ready = true;
        this.send(entry);
      });
      view.webContents.on('will-navigate', (event) => {
        event.preventDefault();
      });
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      view.webContents.loadFile(paths.overlayHtml, { query: { layer: 'voice' } }).catch((error: unknown) => {
        logError('overlay', 'Failed to load the voice glow', error);
      });
      return entry;
    });
    win.on('resize', () => {
      if (this.active || this.caption !== '') {
        this.layout();
      }
    });
  }

  views(): WebContentsView[] {
    return this.parts.map((entry) => entry.view);
  }

  private layout(): void {
    this.laidOut = true;
    const [width, height] = this.win.getContentSize();
    const w = width ?? 0;
    const h = height ?? 0;
    for (const entry of this.parts) {
      switch (entry.part) {
        case 'top':
          entry.rect = { x: 0, y: 0, width: w, height: EDGE };
          break;
        case 'bottom':
          entry.rect = { x: 0, y: Math.max(0, h - EDGE), width: w, height: EDGE };
          break;
        case 'left':
          entry.rect = { x: 0, y: EDGE, width: EDGE, height: Math.max(1, h - EDGE * 2) };
          break;
        case 'right':
          entry.rect = { x: Math.max(0, w - EDGE), y: EDGE, width: EDGE, height: Math.max(1, h - EDGE * 2) };
          break;
        case 'wave':
          entry.rect = {
            x: Math.round((w - WAVE_WIDTH) / 2),
            y: Math.max(0, h - WAVE_HEIGHT - WAVE_BOTTOM),
            width: WAVE_WIDTH,
            height: WAVE_HEIGHT,
          };
          break;
      }
      entry.view.setBounds(entry.rect);
      this.win.contentView.addChildView(entry.view);
      this.send(entry);
    }
  }

  private payload(entry: Part): VoiceGlowPayload {
    const [width, height] = this.win.getContentSize();
    return {
      kind: 'voice',
      part: entry.part,
      active: this.active,
      thinking: this.thinking,
      level: this.level,
      text: this.text,
      caption: this.caption,
      note: this.note,
      windowWidth: width ?? 0,
      windowHeight: height ?? 0,
      x: entry.rect.x,
      y: entry.rect.y,
    };
  }

  private send(entry: Part): void {
    if (!entry.ready || entry.view.webContents.isDestroyed()) {
      return;
    }
    entry.view.webContents.send('overlay:render', this.payload(entry));
  }

  setState(active: boolean, thinking: boolean, text: string): void {
    if (this.win.isDestroyed()) {
      return;
    }
    this.thinking = thinking;
    this.text = text.slice(0, 120);
    if (thinking && this.text !== '') {
      this.caption = this.text;
      this.note = '';
    }
    if (active) {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      const wasActive = this.active;
      this.active = true;
      if (!wasActive) {
        this.layout();
      } else {
        for (const entry of this.parts) {
          this.send(entry);
        }
      }
      for (const entry of this.parts) {
        entry.view.setVisible(true);
      }
      return;
    }
    if (!this.active) {
      return;
    }
    this.active = false;
    this.level = 0;
    for (const entry of this.parts) {
      this.send(entry);
    }
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.active) {
        for (const entry of this.parts) {
          entry.view.setVisible(entry.part === 'wave' && this.caption !== '');
        }
      }
    }, HIDE_DELAY_MS);
  }

  /** Pops what Musix heard (and what it is doing) on screen for a few seconds. */
  showCommand(transcript: string, note: string): void {
    if (this.win.isDestroyed() || transcript.trim() === '') {
      return;
    }
    this.caption = transcript.trim().slice(0, 140);
    this.note = note.trim().slice(0, 80);
    if (this.captionTimer) {
      clearTimeout(this.captionTimer);
    }
    if (!this.laidOut) {
      this.layout();
    }
    for (const entry of this.parts) {
      this.send(entry);
      if (entry.part === 'wave') {
        this.win.contentView.addChildView(entry.view);
        entry.view.setVisible(true);
      }
    }
    this.captionTimer = setTimeout(() => {
      this.captionTimer = null;
      this.caption = '';
      this.note = '';
      for (const entry of this.parts) {
        this.send(entry);
      }
      setTimeout(() => {
        if (!this.active && this.caption === '') {
          for (const entry of this.parts) {
            entry.view.setVisible(false);
          }
        }
      }, HIDE_DELAY_MS);
    }, CAPTION_MS);
  }

  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(1, level));
    const now = Date.now();
    if (!this.active || now - this.lastLevelSent < LEVEL_INTERVAL_MS) {
      return;
    }
    this.lastLevelSent = now;
    for (const entry of this.parts) {
      this.send(entry);
    }
  }
}
