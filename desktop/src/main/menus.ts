import { clipboard } from 'electron';
import type { ItemMenuInfo, ItemTarget, MenuAction, MenuTarget } from '../shared/types';
import type { OverlayLayers } from './overlay';
import type { YtmView } from './view';
import { buildMenuItems } from '../shared/native';

export interface MenuDeps {
  overlays: OverlayLayers;
  view: YtmView;
  shellContents: () => Electron.WebContents | null;
  notify: (title: string, message: string) => void;
}

export class MenuController {
  private pendingInfo = new Map<string, { target: ItemTarget; x: number; y: number }>();

  constructor(private readonly deps: MenuDeps) {}

  open(target: MenuTarget, x: number, y: number, info: ItemMenuInfo): void {
    const clipboardText = Promise.resolve(clipboard.readText() as unknown as string | Promise<string>);
    clipboardText
      .catch(() => '')
      .then((text) => {
        const items = buildMenuItems(target, info, typeof text === 'string' && text.length > 0);
        if (items.every((item) => item.disabled)) {
          return;
        }
        this.deps.overlays.showMenu(
          { title: info.title, items },
          { x, y },
          {
            onSelect: (id) => {
              this.execute(target, id as MenuAction);
            },
            onClose: () => undefined,
          },
        );
      })
      .catch(() => undefined);
  }

  requestItemMenu(target: ItemTarget, x: number, y: number): void {
    const requestId = this.deps.view.nextRequestId();
    this.pendingInfo.set(requestId, { target, x, y });
    if (!this.deps.view.sendDesktop({ type: 'itemInfo', requestId, target })) {
      this.pendingInfo.delete(requestId);
    }
    setTimeout(() => {
      this.pendingInfo.delete(requestId);
    }, 3000);
  }

  resolveItemInfo(requestId: string, info: ItemMenuInfo | null): void {
    const pending = this.pendingInfo.get(requestId);
    this.pendingInfo.delete(requestId);
    if (!pending || !info || info.actions.length === 0) {
      return;
    }
    this.open(pending.target, pending.x, pending.y, info);
  }

  private execute(target: MenuTarget, action: MenuAction): void {
    if (target.kind === 'shellText' || target.kind === 'ytmText') {
      const contents = target.kind === 'shellText' ? this.deps.shellContents() : this.deps.view.webContents;
      if (!contents || contents.isDestroyed()) {
        return;
      }
      contents.focus();
      if (action === 'cut') {
        contents.cut();
      } else if (action === 'copy') {
        contents.copy();
      } else if (action === 'paste') {
        contents.paste();
      } else if (action === 'selectAll') {
        contents.selectAll();
      }
      return;
    }
    this.deps.view.sendDesktop({ type: 'itemAction', target, action });
  }

  copyLink(url: string): void {
    Promise.resolve(clipboard.writeText(url)).then(
      () => {
        this.deps.notify('Link copied', url);
      },
      () => {
        this.deps.notify('Could not copy link', 'The clipboard is not available.');
      },
    );
  }
}
