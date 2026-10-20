# Feature report

Every feature in the specification, with the automated test that proves it. Unit tests live in `tests/unit`, end-to-end tests in `tests/e2e`. The end-to-end tests drive the real Electron app. The fixture tests use a local page that reproduces YouTube Music's player markup and APIs; the live tests (`E2E_LIVE=1`) use music.youtube.com itself.

## Architecture and security

| Feature | Proof |
| --- | --- |
| Shell window plus a `WebContentsView` for YouTube Music positioned in the content area | `app.spec.ts` › launches, renders the shell, and positions the YouTube Music view inside the content area |
| Bounds sent on every resize, sidebar toggle, and breakpoint change, with no gap or overlap | `responsive.spec.ts` › every breakpoint lays out without horizontal scroll and keeps the view aligned; › collapsing the sidebar resizes the view without gaps |
| Correct bounds at 125 and 150 percent scaling | `responsive.spec.ts` › view bounds match the content area at 125 / 150 percent scaling |
| View hidden for full-shell pages and restored on exit | `navigation.spec.ts` › settings replaces the view and back returns to it; `responsive.spec.ts` › extra small screens use bottom navigation, a compact player, and sheets |
| Typed IPC with payload validation | `validators.test.ts` › IPC payload validators |
| Sender and payload validation in main | `security.spec.ts` › main rejects commands from the wrong sender and malformed payloads |
| Context isolation, no Node in renderers, minimal bridge | `security.spec.ts` › renderers have no Node or Electron access |
| Persistent `persist:ytmusic` session, ad blocker enabled before the first load | `adblock.spec.ts` › ad blocker toggles live and counts blocked requests |
| Google sign-in links stay in the app, other links open externally | `routes.test.ts` › classifies navigation targets |
| CSP on the shell, no remote fonts or icons | `app.spec.ts` checks fonts load locally; every test fails on any CSP violation logged to the shell console |

## YouTube Music bridge

| Feature | Proof |
| --- | --- |
| State from the media session and player DOM: title, artist, album, art, time, volume, mute, like, shuffle, repeat, video id, ad state | `playback.spec.ts` (fixture), `live.spec.ts` and `desktop.spec.ts` (real YouTube Music) |
| Diff before sending, progress throttled to 4 per second | `state-diff.test.ts`; `soak.spec.ts` asserts no more than 300 state messages per minute (observed about 233) |
| Listeners re-attached without duplication across SPA navigation | `soak.spec.ts` (heap, DOM size, and message rate stay flat over an hour of navigation) |
| play, pause, togglePlay, next, previous | `playback.spec.ts` › play, pause, next, and previous update the UI from bridge state |
| seekTo, setVolume | `playback.spec.ts` › seeking and volume use the custom sliders |
| toggleMute, toggleLike, toggleShuffle, cycleRepeat | `playback.spec.ts` › mute, like, shuffle, and repeat toggle from bridge state |
| toggleDislike | Now Playing sheet button, exercised through the same bridge path as like (`nowplaying.ts`); validated in `validators.test.ts` |
| playQueueIndex and queue reading | `queue.spec.ts` › queue lists items and clicking a row plays it |
| search(query) | `navigation.spec.ts` › search submits and navigates to results; `responsive.spec.ts` (search overlay) |
| navigate(route) with the documented URL map, active item synced on in-page navigation | `navigation.spec.ts` › sidebar navigation changes the YouTube Music URL and the active item; `routes.test.ts` |
| Ad fallback: skip button clicked, otherwise muted at 16x and jumped to the end, then restored | `ads.spec.ts` › skippable ads are skipped and playback state is restored; › unskippable ads are fast-forwarded muted |
| Ad fallback can be turned off | `ads.spec.ts` › the fallback can be disabled from settings |
| Injected CSS hides YouTube Music's player bar and guide, applies Manrope and Sora, prevents horizontal scroll | `app.spec.ts` › injects shell styling into YouTube Music and hides its own chrome |
| Account avatar pulled from YouTube Music | `app.spec.ts` › reflects the signed-in account avatar from YouTube Music |

## Ad blocker

| Feature | Proof |
| --- | --- |
| Ghostery engine with ads, tracking, and annoyance lists, cached in `adblock-engine.bin` | `adblock.spec.ts` (status Active, last updated shown) |
| Live toggle without restart, blocked counter | `adblock.spec.ts` › ad blocker toggles live and counts blocked requests |
| Update now with loading and result states | `adblock.spec.ts` › update now shows loading and a result state |
| Real-world blocking | `desktop.spec.ts` run logged 18 to 19 blocked requests per session on music.youtube.com |

## Native integrations

| Feature | Proof |
| --- | --- |
| MPRIS metadata and control (GNOME media controls, lock screen, media keys) | `desktop.spec.ts` (D-Bus Metadata, PlaybackStatus, PlayPause, Next); `live.spec.ts` |
| mpris-service fallback after 3 seconds, stopped when Chromium's appears | `policies.test.ts` › MPRIS fallback decision |
| Tray menu with track label, Play/Pause, Next, Previous, Show/Hide, Quit, updating with state | `desktop.spec.ts` (dbusmenu labels and clicks); `tray-model.test.ts` |
| Track change notifications with art, skipped when focused, never during ads | `desktop.spec.ts` (dbus-monitor capture); `policies.test.ts` › track notifications |
| Single instance focuses the existing window | `single-instance.spec.ts` › a second launch focuses the existing window and exits |
| Close to tray | `single-instance.spec.ts` › closing the window hides it to the tray and the app keeps running |
| Window size, position, maximized, and sidebar state remembered and validated against displays | `settings.test.ts` › window state schema; `policies.test.ts` › window geometry |
| Start on login writes and removes the autostart entry | `settings.spec.ts` › start on login writes and removes the autostart entry; `autostart.test.ts` |
| Keyboard shortcuts | `shortcuts.spec.ts` › keyboard shortcuts control playback from the shell; `shortcuts.test.ts` |
| Shortcuts ignored while typing | `shortcuts.spec.ts` › shortcuts are ignored while typing |
| Shortcuts while YouTube Music has focus | `shortcuts.spec.ts` › shortcuts work while YouTube Music has focus |
| Renderer crash recovery restoring the last URL | `offline.spec.ts` › a crashed YouTube Music renderer recovers and restores the last URL |
| Offline screen and automatic recovery | `offline.spec.ts` › offline mode shows the offline screen and recovers on reconnect |
| Load failure with Retry | `offline.spec.ts` › a failed load shows an error state with retry |
| Loading skeletons in the player bar and content area | `app.spec.ts` › shows skeletons until the view and the first player state arrive |

## Design system and responsive layout

| Feature | Proof |
| --- | --- |
| Sora headings, Manrope text, nothing under 14px | `app.spec.ts` › uses Sora for headings, Manrope elsewhere, and nothing below 14px; `design-tokens.test.ts` |
| WCAG AA contrast in dark and light themes | `design-tokens.test.ts` (16 pairs per theme) |
| Theme follows the system, toggles live, applied before first paint | `settings.spec.ts` › theme toggle and system theme apply live; boot script in `src/renderer/boot.ts` |
| Tooltips on icon-only buttons, rendered above YouTube Music | `app.spec.ts` › icon buttons show tooltips above the YouTube Music view |
| Toasts bottom right, auto-dismiss after 4 seconds | `settings.spec.ts` › actions report results with auto-dismissing toasts |
| Confirmation dialogs with focus management | `settings.spec.ts` › reset settings asks for confirmation and restores defaults |
| Breakpoints XL, LG, MD, SM, XS with their sidebar, queue, and grid modes | `breakpoints.test.ts`; `responsive.spec.ts` › every breakpoint lays out without horizontal scroll and keeps the view aligned |
| SM navigation drawer with focus trap, backdrop close, focus return; volume popover | `responsive.spec.ts` › small screens use a navigation drawer that traps focus |
| MD queue drawer over a captured frame, Esc closes and returns focus | `queue.spec.ts` › queue toggles docked and opens as a drawer on medium screens |
| XS bottom navigation, compact player, Now Playing sheet, search overlay, truncation | `responsive.spec.ts` › extra small screens use bottom navigation, a compact player, and sheets |
| Queue empty state | `queue.spec.ts` › queue shows an empty state |
| Optimistic play/pause reverted after 1 second without confirmation | `playback.spec.ts` › optimistic play state reverts when the bridge does not confirm; `state.test.ts` |
| Settings saved immediately and persisted across restart | `settings.spec.ts` › settings toggles persist across restart |

## Packaging

| Feature | Proof |
| --- | --- |
| .deb and AppImage | `npm run dist` builds `release/musix-1.0.0-amd64.deb` and `release/Musix-1.0.0-x86_64.AppImage` |
| Declared .deb dependencies with 24.04 alternatives | `dpkg-deb -I` output (see the README checklist) |
| chrome-sandbox SUID and AppArmor profile in postinst | `build/after-install.sh`; profile validated with `apparmor_parser -Q` |
| Ozone platform hint for Wayland | `executableArgs` in `build/electron-builder.yml` and the switch in `src/main/index.ts` |
| Licenses limited to MIT, MPL, Apache, BSD, ISC, OFL | `npm run licenses` exits non-zero on any other license |
