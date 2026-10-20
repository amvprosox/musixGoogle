import { columnsFor } from '../../shared/breakpoints';
import { formatCount, formatTimestamp } from '../../shared/format';
import { errorMessage } from '../../shared/guards';
import { SHORTCUT_LIST } from '../../shared/shortcuts';
import type { AdblockStatus, AppSettings, ThemePreference } from '../../shared/types';
import type { AppContext } from '../context';
import { h, hydrate, icon, setAttr, setButtonIcon, setText } from '../dom';
import type { IconName } from '../icons';

type BooleanKey = Exclude<keyof AppSettings, 'theme'>;

function card(id: string, iconName: IconName, title: string, body: Node[], extraClass = ''): HTMLElement {
  return h(
    'section',
    {
      className: `card${extraClass ? ` ${extraClass}` : ''}`,
      attrs: { id, 'aria-labelledby': `${id}-title` },
    },
    [
      h('div', { className: 'card-header' }, [
        h('span', { className: 'card-header-icon', attrs: { 'aria-hidden': 'true' } }, [icon(iconName)]),
        h('h3', { className: 'card-title', attrs: { id: `${id}-title` }, text: title }),
      ]),
      h('div', { className: 'card-body' }, body),
    ],
  );
}

function settingRow(label: string, description: string, control: HTMLElement, labelId: string): HTMLElement {
  return h('div', { className: 'setting-row' }, [
    h('div', { className: 'setting-text' }, [
      h('span', { className: 'setting-label', attrs: { id: labelId }, text: label }),
      h('span', { className: 'setting-desc', text: description }),
    ]),
    control,
  ]);
}

type ButtonState = 'idle' | 'loading' | 'success' | 'error';

function actionButton(
  id: string,
  label: string,
  iconName: IconName,
  tone: 'default' | 'primary' | 'danger',
): HTMLButtonElement {
  const className = tone === 'primary' ? 'btn btn-primary' : tone === 'danger' ? 'btn btn-danger' : 'btn';
  return h('button', { className, attrs: { type: 'button', id, 'data-state': 'idle' } }, [
    icon(iconName),
    h('span', { className: 'btn-label', text: label }),
  ]);
}

function setButtonState(
  button: HTMLButtonElement,
  state: ButtonState,
  label: string,
  idleIcon: IconName,
): void {
  button.dataset.state = state;
  button.disabled = state === 'loading';
  setAttr(button, 'aria-busy', state === 'loading' ? 'true' : null);
  const iconName: IconName =
    state === 'loading'
      ? 'loader-circle'
      : state === 'success'
        ? 'circle-check'
        : state === 'error'
          ? 'circle-alert'
          : idleIcon;
  setButtonIcon(button, iconName);
  setText(button.querySelector('.btn-label'), label);
}

export function mountSettings(root: HTMLElement, ctx: AppContext): void {
  const { store, api, toasts } = ctx;
  const switches = new Map<BooleanKey, HTMLButtonElement>();

  const makeSwitch = (key: BooleanKey, labelId: string): HTMLButtonElement => {
    const button = h(
      'button',
      {
        className: 'switch',
        attrs: {
          type: 'button',
          role: 'switch',
          'aria-checked': 'false',
          'aria-labelledby': labelId,
          id: `setting-${key}`,
        },
        on: {
          click: () => {
            const current = store.getState().settings[key];
            button.disabled = true;
            const patch: Partial<AppSettings> = { [key]: !current };
            api
              .invoke('settings:set', patch)
              .then((settings) => {
                store.dispatch({ type: 'settings', settings });
              })
              .catch((error: unknown) => {
                toasts.show({ variant: 'error', title: 'Setting not saved', message: errorMessage(error) });
              })
              .finally(() => {
                button.disabled = false;
              });
          },
        },
      },
      [h('span', { className: 'switch-track' }, [h('span', { className: 'switch-thumb' })])],
    );
    switches.set(key, button);
    return button;
  };

  const toggleRow = (key: BooleanKey, label: string, description: string): HTMLElement => {
    const labelId = `label-${key}`;
    return settingRow(label, description, makeSwitch(key, labelId), labelId);
  };

  const themeOptions: { value: ThemePreference; label: string; icon: IconName }[] = [
    { value: 'system', label: 'System', icon: 'monitor' },
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
  ];
  const themeButtons = new Map<ThemePreference, HTMLButtonElement>();
  const themeGroup = h(
    'div',
    {
      className: 'segmented',
      attrs: { role: 'radiogroup', 'aria-labelledby': 'label-theme', id: 'theme-segmented' },
    },
    themeOptions.map((option) => {
      const button = h(
        'button',
        {
          attrs: {
            type: 'button',
            role: 'radio',
            'aria-checked': 'false',
            'data-value': option.value,
            tabindex: -1,
          },
          on: {
            click: () => {
              api
                .invoke('settings:set', { theme: option.value })
                .then((settings) => {
                  store.dispatch({ type: 'settings', settings });
                })
                .catch((error: unknown) => {
                  toasts.show({ variant: 'error', title: 'Theme not saved', message: errorMessage(error) });
                });
            },
            keydown: (event) => {
              const index = themeOptions.findIndex((o) => o.value === option.value);
              let nextIndex = -1;
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                nextIndex = (index + 1) % themeOptions.length;
              }
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                nextIndex = (index - 1 + themeOptions.length) % themeOptions.length;
              }
              if (nextIndex >= 0) {
                event.preventDefault();
                event.stopPropagation();
                const target = themeOptions[nextIndex];
                if (target) {
                  const targetButton = themeButtons.get(target.value);
                  if (targetButton) {
                    targetButton.focus();
                    targetButton.click();
                  }
                }
              }
            },
          },
        },
        [icon(option.icon), h('span', { text: option.label })],
      );
      themeButtons.set(option.value, button);
      return button;
    }),
  );

  const blockedValue = h('span', { className: 'stat-value', attrs: { id: 'adblock-count' }, text: '0' });
  const updatedValue = h('span', {
    className: 'stat-value small',
    attrs: { id: 'adblock-updated' },
    text: 'Never',
  });
  const statusLine = h('div', { className: 'status-line', attrs: { id: 'adblock-status', role: 'status' } }, [
    h('span', { className: 'status-icon' }, [icon('shield')]),
    h('span', { className: 'status-text' }),
  ]);
  const updateButton = actionButton('adblock-update', 'Update now', 'refresh-cw', 'default');
  let updateResetTimer: number | null = null;
  updateButton.addEventListener('click', () => {
    setButtonState(updateButton, 'loading', 'Updating', 'refresh-cw');
    if (updateResetTimer !== null) {
      window.clearTimeout(updateResetTimer);
    }
    api
      .invoke('adblock:update-now', null)
      .then((status) => {
        store.dispatch({ type: 'adblock', adblock: status });
        if (status.lastError) {
          setButtonState(updateButton, 'error', 'Update failed', 'refresh-cw');
          toasts.show({ variant: 'error', title: 'Filter lists not updated', message: status.lastError });
        } else {
          setButtonState(updateButton, 'success', 'Up to date', 'refresh-cw');
          toasts.show({
            variant: 'success',
            title: 'Filter lists updated',
            message: 'The ad blocker is using the latest lists.',
          });
        }
      })
      .catch((error: unknown) => {
        setButtonState(updateButton, 'error', 'Update failed', 'refresh-cw');
        toasts.show({ variant: 'error', title: 'Filter lists not updated', message: errorMessage(error) });
      })
      .finally(() => {
        updateResetTimer = window.setTimeout(() => {
          updateResetTimer = null;
          setButtonState(updateButton, 'idle', 'Update now', 'refresh-cw');
        }, 2500);
      });
  });

  const clearCacheButton = actionButton('data-clear-cache', 'Clear cache', 'hard-drive', 'default');
  clearCacheButton.addEventListener('click', () => {
    setButtonState(clearCacheButton, 'loading', 'Clearing', 'hard-drive');
    api
      .invoke('data:clear-cache', null)
      .then(() => {
        setButtonState(clearCacheButton, 'success', 'Cache cleared', 'hard-drive');
        toasts.show({
          variant: 'success',
          title: 'Cache cleared',
          message: 'Cached YouTube Music files were removed.',
        });
      })
      .catch((error: unknown) => {
        setButtonState(clearCacheButton, 'error', 'Clear failed', 'hard-drive');
        toasts.show({ variant: 'error', title: 'Cache not cleared', message: errorMessage(error) });
      })
      .finally(() => {
        window.setTimeout(() => {
          setButtonState(clearCacheButton, 'idle', 'Clear cache', 'hard-drive');
        }, 2500);
      });
  });

  const signOutButton = actionButton('data-sign-out', 'Sign out and clear data', 'power', 'danger');
  signOutButton.addEventListener('click', () => {
    ctx
      .confirm({
        title: 'Sign out of YouTube Music?',
        message:
          'This removes your Google sign-in, cookies, and cached data from Musix. Your YouTube Music library is not affected.',
        confirmLabel: 'Sign out',
        cancelLabel: 'Cancel',
        tone: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        setButtonState(signOutButton, 'loading', 'Signing out', 'power');
        api
          .invoke('data:sign-out', null)
          .then(() => {
            toasts.show({
              variant: 'success',
              title: 'Signed out',
              message: 'Your session data was cleared.',
            });
          })
          .catch((error: unknown) => {
            toasts.show({ variant: 'error', title: 'Sign out failed', message: errorMessage(error) });
          })
          .finally(() => {
            setButtonState(signOutButton, 'idle', 'Sign out and clear data', 'power');
          });
      })
      .catch((error: unknown) => {
        console.warn('[settings] confirm failed', error);
      });
  });

  const resetButton = actionButton('data-reset', 'Reset settings', 'rotate-cw', 'default');
  resetButton.addEventListener('click', () => {
    ctx
      .confirm({
        title: 'Reset all settings?',
        message: 'Theme, playback, ad blocker, and system preferences return to their defaults.',
        confirmLabel: 'Reset',
        cancelLabel: 'Cancel',
        tone: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        api
          .invoke('settings:reset', null)
          .then((settings) => {
            store.dispatch({ type: 'settings', settings });
            toasts.show({
              variant: 'success',
              title: 'Settings reset',
              message: 'Default preferences restored.',
            });
          })
          .catch((error: unknown) => {
            toasts.show({ variant: 'error', title: 'Reset failed', message: errorMessage(error) });
          });
      })
      .catch((error: unknown) => {
        console.warn('[settings] confirm failed', error);
      });
  });

  const versionText = h('span', { className: 'stat-value small', attrs: { id: 'app-version' }, text: '' });

  const shortcutRows = SHORTCUT_LIST.map((entry) =>
    h('tr', {}, [
      h('td', { text: entry.description }),
      h('td', {}, [h('span', { className: 'kbd', text: entry.keys })]),
    ]),
  );

  const grid = h('div', { className: 'settings-grid' }, [
    card('settings-playback', 'music', 'Playback', [
      toggleRow(
        'notifyOnTrackChange',
        'Track notifications',
        'Show a desktop notification when the track changes while Musix is in the background.',
      ),
      toggleRow(
        'adSkipFallback',
        'Skip ads that get through',
        'Mute and fast-forward video and audio ads the network blocker could not stop.',
      ),
    ]),
    card(
      'settings-adblock',
      'shield',
      'Ad Blocker',
      [
        toggleRow(
          'adblockEnabled',
          'Block ads and trackers',
          'Uses the Ghostery engine with ads, tracking, and annoyance lists.',
        ),
        h('div', { className: 'stat-grid' }, [
          h('div', { className: 'stat' }, [
            h('span', { className: 'stat-label', text: 'Blocked this session' }),
            blockedValue,
          ]),
          h('div', { className: 'stat' }, [
            h('span', { className: 'stat-label', text: 'Lists updated' }),
            updatedValue,
          ]),
        ]),
        statusLine,
        h('div', { className: 'button-row' }, [updateButton]),
      ],
      'span-2',
    ),
    card('settings-appearance', 'palette', 'Appearance', [
      settingRow('Theme', 'Follow the system or pick a fixed theme.', themeGroup, 'label-theme'),
      toggleRow(
        'queueOpenOnWideScreens',
        'Open queue on wide screens',
        'Dock the queue panel automatically on windows 1440 pixels and wider.',
      ),
    ]),
    card('settings-system', 'monitor', 'System', [
      toggleRow(
        'closeToTray',
        'Close to tray',
        'Keep playing in the background when the window is closed. Quit from the tray or with Ctrl+Q.',
      ),
      toggleRow(
        'startOnLogin',
        'Start on login',
        'Launch Musix in the tray when you sign in to your desktop.',
      ),
    ]),
    card('settings-data', 'hard-drive', 'Data', [
      h('p', { className: 'setting-desc', text: 'Manage what Musix stores on this computer.' }),
      h('div', { className: 'button-row' }, [clearCacheButton, resetButton, signOutButton]),
    ]),
    card(
      'settings-shortcuts',
      'keyboard',
      'Keyboard shortcuts',
      [
        h('div', { className: 'shortcut-table-wrap' }, [
          h('table', { className: 'shortcut-table' }, [h('tbody', {}, shortcutRows)]),
        ]),
      ],
      'span-2',
    ),
    card('settings-about', 'info', 'About', [
      h('div', { className: 'stat' }, [h('span', { className: 'stat-label', text: 'Version' }), versionText]),
      h('p', {
        className: 'setting-desc',
        text: 'Musix is free, open-source software under the MIT license. It is not affiliated with or endorsed by Google or YouTube. Streaming happens only through the official YouTube Music web player.',
      }),
    ]),
  ]);

  const inner = h('div', { className: 'settings-inner' }, [
    h('header', { className: 'page-header' }, [
      h('h1', { attrs: { id: 'settings-heading' }, text: 'Settings' }),
      h('p', { text: 'Changes are saved and applied immediately.' }),
    ]),
    grid,
  ]);
  root.replaceChildren(inner);
  root.setAttribute('aria-labelledby', 'settings-heading');
  hydrate(root);

  const applyColumns = (): void => {
    const width = grid.getBoundingClientRect().width;
    const columns = columnsFor(width, store.getState().layout.gridColumns);
    grid.style.setProperty('--grid-cols', String(columns));
    grid.dataset.cols = String(columns);
  };
  new ResizeObserver(applyColumns).observe(grid);
  store.select((state) => state.layout.gridColumns, applyColumns);

  store.select(
    (state) => state.settingsOpen,
    (open) => {
      root.hidden = !open;
      if (open) {
        root.scrollTop = 0;
      }
    },
  );

  store.select(
    (state) => state.settings,
    (settings) => {
      for (const [key, button] of switches) {
        setAttr(button, 'aria-checked', settings[key] ? 'true' : 'false');
      }
      for (const [value, button] of themeButtons) {
        const checked = settings.theme === value;
        setAttr(button, 'aria-checked', checked ? 'true' : 'false');
        button.tabIndex = checked ? 0 : -1;
      }
    },
  );

  const renderAdblock = (status: AdblockStatus): void => {
    setText(blockedValue, formatCount(status.blockedCount));
    setText(updatedValue, formatTimestamp(status.lastUpdated));
    let tone = 'muted';
    let text = 'Loading filter lists';
    let iconName: IconName = 'shield';
    if (!status.enabled) {
      tone = 'muted';
      text = 'Ad blocker is off';
      iconName = 'ban';
    } else if (status.updating) {
      text = 'Updating filter lists';
      iconName = 'loader-circle';
    } else if (status.lastError && !status.ready) {
      tone = 'error';
      text = `Lists unavailable: ${status.lastError}`;
      iconName = 'circle-alert';
    } else if (status.lastError) {
      tone = 'error';
      text = `Last update failed, using cached lists: ${status.lastError}`;
      iconName = 'circle-alert';
    } else if (status.ready) {
      tone = 'success';
      text = 'Active';
      iconName = 'circle-check';
    }
    statusLine.dataset.tone = tone;
    const iconHolder = statusLine.querySelector<HTMLElement>('.status-icon');
    if (iconHolder) {
      setButtonIcon(statusLine, iconName);
    }
    setText(statusLine.querySelector('.status-text'), text);
  };

  store.select((state) => state.adblock, renderAdblock);
  store.select(
    (state) => state.version,
    (version) => {
      setText(versionText, version === '' ? 'Unknown' : version);
    },
  );
  window.setInterval(() => {
    setText(updatedValue, formatTimestamp(store.getState().adblock.lastUpdated));
  }, 60000);
}
