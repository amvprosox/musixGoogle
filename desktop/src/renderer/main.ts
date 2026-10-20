import { errorMessage } from '../shared/guards';
import { PlayerActions } from './actions';
import { getShellApi } from './api';
import { mountBottomNav } from './components/bottomnav';
import { mountModal } from './components/modal';
import { mountNowPlaying } from './components/nowplaying';
import { mountViewState } from './components/offline';
import { mountPlayerBar } from './components/playerbar';
import { mountQueue } from './components/queue';
import { mountSearchOverlay } from './components/searchoverlay';
import { mountSettings } from './components/settings';
import { mountSidebar } from './components/sidebar';
import { ToastController } from './components/toast';
import { mountTopbar } from './components/topbar';
import { installBrowserBehaviors } from './behaviors';
import { mountWindowControls } from './chrome';
import { installScrollAreas } from './scroll';
import type { AppContext } from './context';
import { OverlayManager } from './overlays';
import { Router } from './router';
import { installShortcuts } from './shortcuts';
import { createStore, initialState } from './state';
import { TooltipController } from './tooltip';
import { ViewHost } from './viewhost';

function required<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) {
    throw new Error(`Missing element #${id}`);
  }
  return el;
}

function showFatal(message: string): void {
  const fatal = document.getElementById('fatal');
  if (!fatal) {
    return;
  }
  fatal.hidden = false;
  fatal.className = 'state-screen';
  const card = document.createElement('div');
  card.className = 'state-card';
  const title = document.createElement('h2');
  title.textContent = 'Musix could not start';
  const text = document.createElement('p');
  text.textContent = message;
  card.append(title, text);
  fatal.replaceChildren(card);
}

function bootstrap(): void {
  const api = getShellApi();
  if (!api) {
    showFatal('The secure bridge to the application is unavailable.');
    return;
  }
  const app = required('app', HTMLDivElement);
  const boot = api.boot;
  const store = createStore(
    initialState(window.innerWidth, boot ? boot.theme : 'dark', boot ? boot.sidebarCollapsed : false, ''),
  );

  const viewHost = new ViewHost(
    store,
    api,
    required('view-host', HTMLDivElement),
    required('view-freeze', HTMLImageElement),
  );
  const overlays = new OverlayManager(store, viewHost);
  const actions = new PlayerActions(store, api);
  const router = new Router(store, api, overlays);
  const tooltips = new TooltipController(api);
  const playerbar = required('playerbar', HTMLElement);
  const bottomNav = required('bottom-nav', HTMLElement);
  const toasts = new ToastController(api, document.getElementById('live-region'), () => {
    const bar = playerbar.getBoundingClientRect().height;
    const nav = bottomNav.getBoundingClientRect().height;
    return bar + nav;
  });

  let searchInput: HTMLInputElement | null = null;
  const focusSearch = (): void => {
    const state = store.getState();
    if (state.breakpoint === 'xs') {
      overlays.open('search').catch((error: unknown) => {
        console.warn('[main] search overlay failed', error);
      });
      return;
    }
    if (state.settingsOpen) {
      router.closeSettings();
    }
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  };

  const ctx: AppContext = {
    store,
    api,
    actions,
    router,
    overlays,
    viewHost,
    toasts,
    tooltips,
    confirm: () => Promise.resolve(false),
    focusSearch,
  };
  ctx.confirm = mountModal(required('modal-root', HTMLDivElement), ctx);

  mountSidebar(required('sidebar', HTMLElement), ctx);
  const topbarEl = required('topbar', HTMLElement);
  searchInput = mountTopbar(topbarEl, ctx).searchInput;
  mountWindowControls(topbarEl, ctx);
  mountViewState(required('view-state', HTMLDivElement), ctx);
  mountSettings(required('settings-page', HTMLElement), ctx);
  mountQueue(required('queue-panel', HTMLElement), ctx);
  mountPlayerBar(playerbar, ctx);
  mountBottomNav(bottomNav, ctx);
  mountNowPlaying(required('nowplaying', HTMLDivElement), ctx);
  mountSearchOverlay(required('search-overlay', HTMLDivElement), ctx);

  installScrollAreas();
  installBrowserBehaviors(ctx);

  const backdrop = required('backdrop', HTMLDivElement);
  backdrop.addEventListener('click', () => {
    const state = store.getState();
    if (state.sidebarDrawerOpen) {
      overlays.close('sidebar');
    }
    if (state.queueOpen && state.layout.queueMode === 'drawer') {
      overlays.close('queue');
    }
  });

  store.select(
    (state) => ({
      bp: state.breakpoint,
      sidebar: state.layout.sidebarMode,
      queue: state.layout.queueMode,
      queueOpen: state.queueOpen,
      sidebarOpen: state.sidebarDrawerOpen,
      settingsOpen: state.settingsOpen,
    }),
    (layout) => {
      app.dataset.bp = layout.bp;
      app.dataset.sidebar = layout.sidebar;
      app.dataset.queue = layout.queue;
      app.dataset.queueOpen = layout.queueOpen ? 'true' : 'false';
      app.dataset.sidebarOpen = layout.sidebarOpen ? 'true' : 'false';
      app.dataset.settingsOpen = layout.settingsOpen ? 'true' : 'false';
      const backdropOpen = layout.sidebarOpen || (layout.queueOpen && layout.queue === 'drawer');
      backdrop.dataset.open = backdropOpen ? 'true' : 'false';
    },
  );

  store.select(
    (state) => state.theme,
    (theme) => {
      document.documentElement.dataset.theme = theme;
    },
  );

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame !== 0) {
      return;
    }
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      store.dispatch({ type: 'width', width: window.innerWidth });
    });
  });

  const forwardKey = installShortcuts({
    actions,
    focusSearch,
    openSettings: () => {
      router.openSettings();
    },
    escape: () => {
      tooltips.hide();
      if (overlays.closeTop()) {
        return true;
      }
      if (store.getState().settingsOpen) {
        router.closeSettings();
        return true;
      }
      return false;
    },
    quit: () => {
      api.send('app:quit', null);
    },
  });

  api.on('player:state', (player) => {
    store.dispatch({ type: 'player', player });
  });
  api.on('player:queue', (queue) => {
    store.dispatch({ type: 'queue', queue });
  });
  api.on('view:status', (status) => {
    store.dispatch({ type: 'view-status', status });
  });
  api.on('view:nav', (nav) => {
    store.dispatch({ type: 'nav', nav });
  });
  api.on('account:state', (account) => {
    store.dispatch({ type: 'account', account });
  });
  api.on('settings:changed', (settings) => {
    store.dispatch({ type: 'settings', settings });
  });
  api.on('adblock:status', (adblock) => {
    store.dispatch({ type: 'adblock', adblock });
  });
  api.on('theme:system', (dark) => {
    store.dispatch({ type: 'system-dark', dark });
  });
  api.on('shortcut:key', (payload) => {
    forwardKey(payload);
  });
  api.on('window:chrome', (chrome) => {
    store.dispatch({ type: 'chrome', chrome });
  });
  let progressTimer: number | null = null;
  api.on('view:progress', (phase) => {
    if (progressTimer !== null) {
      window.clearTimeout(progressTimer);
      progressTimer = null;
    }
    store.dispatch({ type: 'navigating', value: phase === 'start' });
    if (phase === 'start') {
      progressTimer = window.setTimeout(() => {
        progressTimer = null;
        store.dispatch({ type: 'navigating', value: false });
      }, 10000);
    }
  });
  api.on('notice', (notice) => {
    toasts.show(notice);
  });
  api.on('dialog:show', (dialog) => {
    ctx
      .confirm({
        title: 'YouTube Music',
        message: dialog.message,
        confirmLabel: 'OK',
        cancelLabel: null,
        tone: 'default',
      })
      .catch(() => undefined);
  });
  api.on('app:command', (command) => {
    if (command === 'open-settings') {
      router.openSettings();
    }
    if (command === 'focus-search') {
      focusSearch();
    }
    if (command === 'toggle-queue') {
      store.dispatch({ type: 'queue-open', open: !store.getState().queueOpen });
    }
  });

  store.dispatch({ type: 'online', online: navigator.onLine });
  store.dispatch({ type: 'width', width: window.innerWidth });

  api
    .invoke('app:get-initial', null)
    .then((data) => {
      store.dispatch({ type: 'init', ...data });
      app.dataset.ready = 'true';
    })
    .catch((error: unknown) => {
      showFatal(`Could not load initial state: ${errorMessage(error)}`);
    });
}

try {
  bootstrap();
} catch (error) {
  showFatal(errorMessage(error));
}
