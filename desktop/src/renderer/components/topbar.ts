import type { AppContext } from '../context';
import { h, hydrate, icon, iconButton, setAttr, setButtonIcon, setLabel } from '../dom';

export function buildSearchForm(
  ctx: AppContext,
  options: { id: string; autofocus?: boolean; onSubmitted?: () => void; showHint: boolean },
): { form: HTMLFormElement; input: HTMLInputElement } {
  const input = h('input', {
    className: 'search-input',
    attrs: {
      id: options.id,
      type: 'search',
      name: 'q',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'Search songs, albums, artists',
      'aria-label': 'Search YouTube Music',
      enterkeyhint: 'search',
      maxlength: 500,
      'data-autofocus': options.autofocus ? 'true' : null,
    },
  });
  const form = h(
    'form',
    {
      className: 'search-form',
      attrs: { role: 'search' },
      on: {
        submit: (event) => {
          event.preventDefault();
          if (ctx.router.search(input.value)) {
            input.blur();
            if (options.onSubmitted) {
              options.onSubmitted();
            }
          }
        },
      },
    },
    [
      h('span', { className: 'search-icon', attrs: { 'aria-hidden': 'true' } }, [icon('search')]),
      input,
      options.showHint
        ? h('span', { className: 'search-hint kbd', attrs: { 'aria-hidden': 'true' }, text: 'Ctrl K' })
        : null,
    ],
  );
  return { form, input };
}

export function mountTopbar(root: HTMLElement, ctx: AppContext): { searchInput: HTMLInputElement } {
  const { store, router, overlays, actions } = ctx;

  const hamburger = iconButton({
    icon: 'menu',
    label: 'Open navigation',
    className: 'hamburger',
    attrs: { id: 'hamburger', 'aria-controls': 'sidebar', 'aria-expanded': 'false' },
    onClick: () => {
      overlays.open('sidebar', hamburger).catch((error: unknown) => {
        console.warn('[topbar] could not open navigation', error);
      });
    },
  });

  const back = iconButton({
    icon: 'arrow-left',
    label: 'Back',
    attrs: { id: 'nav-back' },
    onClick: () => {
      router.back();
    },
  });
  const forward = iconButton({
    icon: 'arrow-right',
    label: 'Forward',
    attrs: { id: 'nav-forward' },
    onClick: () => {
      router.forward();
    },
  });

  const { form, input } = buildSearchForm(ctx, { id: 'search-input', showHint: true });

  const searchTrigger = iconButton({
    icon: 'search',
    label: 'Search',
    className: 'search-trigger',
    attrs: { id: 'search-trigger' },
    onClick: () => {
      overlays.open('search', searchTrigger).catch((error: unknown) => {
        console.warn('[topbar] could not open search', error);
      });
    },
  });

  const themeToggle = iconButton({
    icon: 'moon',
    label: 'Switch to dark theme',
    attrs: { id: 'theme-toggle' },
    onClick: () => {
      const next = store.getState().theme === 'dark' ? 'light' : 'dark';
      ctx.api.invoke('settings:set', { theme: next }).catch((error: unknown) => {
        ctx.toasts.show({ variant: 'error', title: 'Could not change theme', message: String(error) });
      });
    },
  });

  const avatarImg = h('img', {
    attrs: { alt: '', width: 32, height: 32, referrerpolicy: 'no-referrer', loading: 'lazy' },
  });
  const avatarButton = h(
    'button',
    {
      className: 'avatar-btn',
      attrs: {
        type: 'button',
        id: 'account-button',
        'aria-label': 'Account menu',
        'data-tooltip': 'Account menu',
      },
      on: {
        click: () => {
          actions.command({ type: 'openAccountMenu' });
        },
      },
    },
    [avatarImg],
  );
  const signInButton = h(
    'button',
    {
      className: 'btn',
      attrs: { type: 'button', id: 'sign-in-button', 'aria-label': 'Sign in', 'data-tooltip': 'Sign in' },
      on: {
        click: () => {
          actions.command({ type: 'signIn' });
        },
      },
    },
    [icon('log-in'), h('span', { className: 'sign-in-label', text: 'Sign in' })],
  );

  const brand = h('div', { className: 'topbar-brand' }, [
    h('img', {
      className: 'brand-mark',
      attrs: { src: 'logo.svg', alt: '', width: 28, height: 28, loading: 'lazy' },
    }),
    h('span', { className: 'brand-name', text: 'Musix' }),
  ]);

  const inner = h('div', { className: 'topbar-inner' }, [
    h('div', { className: 'topbar-group' }, [hamburger]),
    brand,
    h('div', { className: 'topbar-group history-group' }, [back, forward]),
    form,
    h('div', { className: 'topbar-spacer' }),
    h('div', { className: 'topbar-group' }, [searchTrigger, themeToggle, avatarButton, signInButton]),
  ]);
  const progress = h('div', {
    className: 'nav-progress',
    attrs: {
      id: 'nav-progress',
      role: 'progressbar',
      'aria-label': 'Loading page',
      'aria-hidden': 'true',
      'data-active': 'false',
    },
  });
  root.replaceChildren(inner, progress);
  hydrate(root);

  store.select(
    (state) => state.navigating,
    (navigating) => {
      progress.dataset.active = navigating ? 'true' : 'false';
      progress.setAttribute('aria-hidden', navigating ? 'false' : 'true');
    },
  );

  store.select(
    (state) => ({
      canBack: state.settingsOpen || state.nav.canGoBack,
      canForward: !state.settingsOpen && state.nav.canGoForward,
    }),
    ({ canBack, canForward }) => {
      back.disabled = !canBack;
      forward.disabled = !canForward;
    },
  );

  store.select(
    (state) => state.theme,
    (theme) => {
      setButtonIcon(themeToggle, theme === 'dark' ? 'sun' : 'moon');
      setLabel(themeToggle, theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    },
  );

  store.select(
    (state) => ({
      signedIn: state.account.signedIn,
      avatar: state.account.avatarUrl,
      ready: state.initialized,
    }),
    ({ signedIn, avatar }) => {
      avatarButton.hidden = !signedIn;
      signInButton.hidden = signedIn;
      if (signedIn) {
        if (avatar !== '') {
          if (avatarImg.getAttribute('src') !== avatar) {
            avatarImg.src = avatar;
          }
        } else {
          avatarImg.removeAttribute('src');
        }
      }
    },
  );

  store.select(
    (state) => state.sidebarDrawerOpen,
    (open) => {
      setAttr(hamburger, 'aria-expanded', open ? 'true' : 'false');
    },
  );

  store.select(
    (state) => ({ route: state.route, query: state.searchQuery }),
    ({ route, query }) => {
      if (document.activeElement === input) {
        return;
      }
      input.value = route === 'search' ? query : '';
    },
  );

  return { searchInput: input };
}
