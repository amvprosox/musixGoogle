import {
  ArrowLeft,
  ArrowRight,
  ArrowUpLeft,
  Ban,
  Bell,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  Compass,
  Copy,
  createIcons,
  HardDrive,
  Heart,
  House,
  Info,
  Keyboard,
  Library,
  ListMusic,
  LoaderCircle,
  LogIn,
  Menu,
  Minus,
  Monitor,
  Moon,
  Music,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Power,
  RefreshCw,
  Repeat,
  Repeat1,
  RotateCw,
  Search,
  Settings,
  Shield,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Sun,
  TextQuote,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  User,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide';

export const ICONS = {
  ArrowLeft,
  ArrowRight,
  ArrowUpLeft,
  Ban,
  Bell,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  Compass,
  Copy,
  HardDrive,
  Heart,
  House,
  Info,
  Keyboard,
  Library,
  ListMusic,
  LoaderCircle,
  LogIn,
  Menu,
  Minus,
  Monitor,
  Moon,
  Music,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Power,
  RefreshCw,
  Repeat,
  Repeat1,
  RotateCw,
  Search,
  Settings,
  Shield,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Sun,
  TextQuote,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  User,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  WifiOff,
  X,
};

export type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up-left'
  | 'ban'
  | 'bell'
  | 'chevron-down'
  | 'circle-alert'
  | 'circle-check'
  | 'circle-x'
  | 'compass'
  | 'copy'
  | 'minus'
  | 'square'
  | 'hard-drive'
  | 'heart'
  | 'house'
  | 'info'
  | 'keyboard'
  | 'library'
  | 'list-music'
  | 'loader-circle'
  | 'log-in'
  | 'menu'
  | 'monitor'
  | 'moon'
  | 'music'
  | 'palette'
  | 'panel-left-close'
  | 'panel-left-open'
  | 'pause'
  | 'play'
  | 'power'
  | 'refresh-cw'
  | 'repeat'
  | 'repeat-1'
  | 'rotate-cw'
  | 'search'
  | 'settings'
  | 'shield'
  | 'shuffle'
  | 'skip-back'
  | 'skip-forward'
  | 'sun'
  | 'text-quote'
  | 'thumbs-down'
  | 'thumbs-up'
  | 'trash-2'
  | 'triangle-alert'
  | 'user'
  | 'volume'
  | 'volume-1'
  | 'volume-2'
  | 'volume-x'
  | 'wifi-off'
  | 'x';

export function hydrateIcons(root: Element | Document): void {
  createIcons({
    icons: ICONS,
    root,
    attrs: { 'aria-hidden': 'true', focusable: 'false' },
  });
}

export function iconElement(name: IconName): HTMLElement {
  const holder = document.createElement('i');
  holder.setAttribute('data-lucide', name);
  return holder;
}

export function setIcon(container: HTMLElement, name: IconName): void {
  if (container.dataset.icon === name) {
    return;
  }
  container.dataset.icon = name;
  container.replaceChildren(iconElement(name));
  hydrateIcons(container);
}
