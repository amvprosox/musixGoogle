import { WebContentsView, type BrowserWindow } from 'electron';
import { placeFloating, roundRect } from '../shared/policies';
import type {
  MenuItemSpec,
  OverlayRenderPayload,
  OverlaySize,
  ResolvedTheme,
  ToastLayerRequest,
  TooltipRequest,
} from '../shared/types';
import { paths } from './config';
import { logError } from './log';
import { placeMenu } from '../shared/native';

type LayerKind = 'tooltip' | 'toasts' | 'menu';

class OverlayLayer {
  readonly view: WebContentsView;
  private ready = false;
  private pending: OverlayRenderPayload | null = null;
  private size: OverlaySize = { width: 0, height: 0 };
  private active = false;

  constructor(
    win: BrowserWindow,
    readonly kind: LayerKind,
    private readonly place: (size: OverlaySize) => Electron.Rectangle | null,
    devTools: boolean,
  ) {
    this.view = new WebContentsView({
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
    this.view.setBackgroundColor('#00000000');
    this.view.setVisible(false);
    this.view.setBounds({ x: 0, y: 0, width: 480, height: 320 });
    win.contentView.addChildView(this.view);
    this.view.webContents.on('did-finish-load', () => {
      this.ready = true;
      if (this.pending) {
        this.send(this.pending);
      }
    });
    this.view.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.view.webContents.loadFile(paths.overlayHtml, { query: { layer: kind } }).catch((error: unknown) => {
      logError('overlay', `Failed to load ${kind} layer`, error);
    });
  }

  private send(payload: OverlayRenderPayload): void {
    if (this.view.webContents.isDestroyed()) {
      return;
    }
    this.view.webContents.send('overlay:render', payload);
  }

  render(payload: OverlayRenderPayload): void {
    this.pending = payload;
    this.active = payload.kind !== 'clear';
    if (!this.active) {
      this.view.setVisible(false);
    }
    if (this.ready) {
      this.send(payload);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  onSize(size: OverlaySize): void {
    this.size = size;
    this.reposition();
  }

  reposition(): void {
    if (!this.active || this.size.width <= 0 || this.size.height <= 0) {
      this.view.setVisible(false);
      return;
    }
    const rect = this.place(this.size);
    if (!rect) {
      this.view.setVisible(false);
      return;
    }
    this.view.setBounds(rect);
    this.view.setVisible(true);
  }

  owns(contents: Electron.WebContents): boolean {
    return !this.view.webContents.isDestroyed() && this.view.webContents.id === contents.id;
  }
}

export interface MenuHandlers {
  onSelect: (id: string) => void;
  onClose: () => void;
}

export class OverlayLayers {
  private readonly tooltip: OverlayLayer;
  private readonly toasts: OverlayLayer;
  private readonly menu: OverlayLayer;
  private tooltipRequest: TooltipRequest | null = null;
  private toastRequest: ToastLayerRequest | null = null;
  private menuPoint: { x: number; y: number } | null = null;
  private menuSpec: { title: string; items: MenuItemSpec[] } | null = null;
  private menuHandlers: MenuHandlers | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly theme: () => ResolvedTheme,
    devTools: boolean,
  ) {
    this.tooltip = new OverlayLayer(win, 'tooltip', (size) => this.placeTooltip(size), devTools);
    this.toasts = new OverlayLayer(win, 'toasts', (size) => this.placeToasts(size), devTools);
    this.menu = new OverlayLayer(win, 'menu', (size) => this.placeMenuLayer(size), devTools);
    win.on('resize', () => {
      this.tooltip.reposition();
      this.toasts.reposition();
      this.closeMenu();
    });
    win.on('blur', () => {
      this.closeMenu();
    });
    this.menu.view.webContents.on('blur', () => {
      setTimeout(() => {
        if (!this.win.isDestroyed() && !this.menu.view.webContents.isFocused()) {
          this.closeMenu();
        }
      }, 0);
    });
  }

  views(): WebContentsView[] {
    return [this.tooltip.view, this.toasts.view, this.menu.view];
  }

  private contentSize(): { width: number; height: number } {
    const [width, height] = this.win.getContentSize();
    return { width: width ?? 0, height: height ?? 0 };
  }

  private placeTooltip(size: OverlaySize): Electron.Rectangle | null {
    const request = this.tooltipRequest;
    if (!request) {
      return null;
    }
    return placeFloating(request.anchor, size, request.placement, this.contentSize());
  }

  private placeToasts(size: OverlaySize): Electron.Rectangle | null {
    const request = this.toastRequest;
    if (!request || request.toasts.length === 0) {
      return null;
    }
    const container = this.contentSize();
    const width = Math.min(size.width, Math.max(0, container.width - request.right - 8));
    return roundRect({
      x: Math.max(8, container.width - request.right - width),
      y: Math.max(8, container.height - request.bottom - size.height),
      width,
      height: Math.min(size.height, container.height),
    });
  }

  private placeMenuLayer(size: OverlaySize): Electron.Rectangle | null {
    if (!this.menuPoint) {
      return null;
    }
    return placeMenu(this.menuPoint, size, this.contentSize());
  }

  showTooltip(request: TooltipRequest | null): void {
    this.tooltipRequest = request;
    if (!request) {
      this.tooltip.render({ kind: 'clear' });
      return;
    }
    this.tooltip.render({ kind: 'tooltip', text: request.text, theme: this.theme() });
  }

  showToasts(request: ToastLayerRequest): void {
    this.toastRequest = request;
    if (request.toasts.length === 0) {
      this.toasts.render({ kind: 'clear' });
      return;
    }
    const container = this.contentSize();
    const maxWidth = Math.max(160, Math.min(360, container.width - request.right - 8));
    this.toasts.render({ kind: 'toasts', toasts: request.toasts, theme: this.theme(), maxWidth });
  }

  showMenu(
    spec: { title: string; items: MenuItemSpec[] },
    point: { x: number; y: number },
    handlers: MenuHandlers,
  ): void {
    if (this.menuHandlers) {
      const previous = this.menuHandlers;
      this.menuHandlers = null;
      previous.onClose();
    }
    this.showTooltip(null);
    this.menuSpec = spec;
    this.menuPoint = point;
    this.menuHandlers = handlers;
    this.menu.render({ kind: 'menu', title: spec.title, items: spec.items, theme: this.theme() });
  }

  isMenuOpen(): boolean {
    return this.menu.isActive();
  }

  selectMenu(contents: Electron.WebContents, id: string): void {
    if (!this.menu.owns(contents) || !this.menuSpec || !this.menuHandlers) {
      return;
    }
    const item = this.menuSpec.items.find((entry) => entry.id === id && !entry.disabled);
    const handlers = this.menuHandlers;
    this.menuHandlers = null;
    this.hideMenu();
    if (item) {
      handlers.onSelect(item.id);
    }
    handlers.onClose();
  }

  closeMenu(): void {
    if (!this.menu.isActive()) {
      return;
    }
    const handlers = this.menuHandlers;
    this.menuHandlers = null;
    this.hideMenu();
    if (handlers) {
      handlers.onClose();
    }
  }

  private hideMenu(): void {
    this.menuSpec = null;
    this.menuPoint = null;
    this.menu.render({ kind: 'clear' });
    if (!this.win.isDestroyed() && this.win.isFocused()) {
      this.win.webContents.focus();
    }
  }

  handleSize(contents: Electron.WebContents, size: OverlaySize): void {
    for (const layer of [this.tooltip, this.toasts, this.menu]) {
      if (layer.owns(contents)) {
        layer.onSize(size);
        if (layer === this.menu && this.menu.isActive() && size.width > 0) {
          this.menu.view.webContents.focus();
        }
        return;
      }
    }
  }

  owns(contents: Electron.WebContents): boolean {
    return this.tooltip.owns(contents) || this.toasts.owns(contents) || this.menu.owns(contents);
  }

  ownsMenu(contents: Electron.WebContents): boolean {
    return this.menu.owns(contents);
  }

  refreshTheme(): void {
    if (this.tooltipRequest) {
      this.showTooltip(this.tooltipRequest);
    }
    if (this.toastRequest) {
      this.showToasts(this.toastRequest);
    }
    if (this.menuSpec && this.menuPoint && this.menu.isActive()) {
      this.menu.render({
        kind: 'menu',
        title: this.menuSpec.title,
        items: this.menuSpec.items,
        theme: this.theme(),
      });
    }
  }
}
