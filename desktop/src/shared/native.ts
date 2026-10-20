import { roundRect } from './policies';
import type { ItemMenuInfo, MenuAction, MenuItemSpec, MenuTarget, OverlaySize, Rect } from './types';

export const MENU_LABELS: Readonly<Record<MenuAction, { label: string; icon: string }>> = {
  playNext: { label: 'Play next', icon: 'list-start' },
  addToQueue: { label: 'Add to queue', icon: 'list-plus' },
  like: { label: 'Like', icon: 'heart' },
  goArtist: { label: 'Go to artist', icon: 'mic-vocal' },
  goAlbum: { label: 'Go to album', icon: 'disc-3' },
  copyLink: { label: 'Copy link', icon: 'link' },
  cut: { label: 'Cut', icon: 'scissors' },
  copy: { label: 'Copy', icon: 'copy' },
  paste: { label: 'Paste', icon: 'clipboard-paste' },
  selectAll: { label: 'Select all', icon: 'scan-text' },
};

export const ITEM_ACTION_ORDER: readonly MenuAction[] = [
  'playNext',
  'addToQueue',
  'like',
  'goArtist',
  'goAlbum',
  'copyLink',
];
export const TEXT_ACTION_ORDER: readonly MenuAction[] = ['cut', 'copy', 'paste', 'selectAll'];

export function buildMenuItems(
  target: MenuTarget,
  info: ItemMenuInfo,
  hasClipboardText: boolean,
): MenuItemSpec[] {
  const isText = target.kind === 'shellText' || target.kind === 'ytmText';
  const order = isText ? TEXT_ACTION_ORDER : ITEM_ACTION_ORDER;
  return order.map((id) => ({
    id,
    label: MENU_LABELS[id].label,
    icon: MENU_LABELS[id].icon,
    disabled: isText ? id === 'paste' && !hasClipboardText : !info.actions.includes(id),
  }));
}

export function placeMenu(
  point: { x: number; y: number },
  size: OverlaySize,
  container: { width: number; height: number },
  margin = 8,
): Rect {
  let x = point.x;
  let y = point.y;
  if (x + size.width > container.width - margin) {
    x = Math.max(margin, point.x - size.width);
  }
  if (y + size.height > container.height - margin) {
    y = Math.max(margin, point.y - size.height);
  }
  return roundRect({
    x,
    y,
    width: Math.min(size.width, container.width - margin * 2),
    height: Math.min(size.height, container.height - margin * 2),
  });
}

const BLOCKED_CTRL_KEYS = new Set([
  'r',
  'p',
  's',
  'u',
  'f',
  'g',
  'j',
  'o',
  'n',
  't',
  'w',
  'h',
  '+',
  '=',
  '-',
  '_',
  '0',
  'add',
  'subtract',
]);
const BLOCKED_KEYS = new Set([
  'F5',
  'F11',
  'F12',
  'F3',
  'F7',
  'BrowserBack',
  'BrowserForward',
  'BrowserRefresh',
  'ZoomIn',
  'ZoomOut',
]);

export function isBlockedBrowserShortcut(
  input: { key: string; control: boolean; meta: boolean; alt: boolean; shift: boolean },
  devMode: boolean,
): boolean {
  const key = input.key.toLowerCase();
  if (devMode && (key === 'i' || key === 'f12') && input.control && input.shift) {
    return false;
  }
  if (BLOCKED_KEYS.has(input.key)) {
    return !(devMode && input.key === 'F12');
  }
  if (input.control || input.meta) {
    if (input.shift && ['i', 'j', 'c', 'r', 'delete'].includes(key)) {
      return true;
    }
    return BLOCKED_CTRL_KEYS.has(key);
  }
  return false;
}
