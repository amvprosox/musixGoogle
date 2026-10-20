import { Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import { APP_NAME } from '../shared/constants';
import { trayMenuModel } from '../shared/tray-model';
import type { PlayerCommand, PlayerState } from '../shared/types';
import { appIconPath } from './config';
import { logWarn } from './log';

export interface TrayHandlers {
  command: (command: PlayerCommand) => void;
  toggleWindow: () => void;
  quit: () => void;
}

export class AppTray {
  private tray: Tray | null = null;
  private lastModelKey = '';
  private state: PlayerState | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly handlers: TrayHandlers,
  ) {
    try {
      const image = nativeImage.createFromPath(appIconPath(32));
      this.tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
      this.tray.setToolTip(APP_NAME);
      this.tray.on('click', () => {
        this.handlers.toggleWindow();
      });
      this.refresh(true);
      win.on('show', () => {
        this.refresh();
      });
      win.on('hide', () => {
        this.refresh();
      });
    } catch (error) {
      logWarn('tray', 'Tray unavailable on this desktop', error);
      this.tray = null;
    }
  }

  update(state: PlayerState): void {
    this.state = state;
    this.refresh();
  }

  refresh(force = false): void {
    const tray = this.tray;
    if (!tray || tray.isDestroyed() || this.win.isDestroyed()) {
      return;
    }
    const model = trayMenuModel(this.state, this.win.isVisible());
    const key = JSON.stringify(model);
    if (!force && key === this.lastModelKey) {
      return;
    }
    this.lastModelKey = key;
    const menu = Menu.buildFromTemplate([
      { label: model.trackLabel, enabled: false },
      { type: 'separator' },
      {
        label: model.playLabel,
        enabled: model.canControl,
        click: () => {
          this.handlers.command({ type: 'togglePlay' });
        },
      },
      {
        label: 'Next',
        enabled: model.canControl,
        click: () => {
          this.handlers.command({ type: 'next' });
        },
      },
      {
        label: 'Previous',
        enabled: model.canControl,
        click: () => {
          this.handlers.command({ type: 'previous' });
        },
      },
      { type: 'separator' },
      {
        label: model.windowLabel,
        click: () => {
          this.handlers.toggleWindow();
        },
      },
      {
        label: 'Quit',
        click: () => {
          this.handlers.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
    tray.setToolTip(model.canControl ? `${APP_NAME}: ${model.trackLabel}` : APP_NAME);
  }

  dispose(): void {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy();
    }
    this.tray = null;
  }
}
