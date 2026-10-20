import type { ShellApi } from '../shared/channels';
import type { PlayerActions } from './actions';
import type { ToastController } from './components/toast';
import type { OverlayManager } from './overlays';
import type { Router } from './router';
import type { Store } from './state';
import type { TooltipController } from './tooltip';
import type { ViewHost } from './viewhost';

export interface AppContext {
  store: Store;
  api: ShellApi;
  actions: PlayerActions;
  router: Router;
  overlays: OverlayManager;
  viewHost: ViewHost;
  toasts: ToastController;
  tooltips: TooltipController;
  confirm: (options: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string | null;
    tone: 'danger' | 'default';
  }) => Promise<boolean>;
  focusSearch: () => void;
}
