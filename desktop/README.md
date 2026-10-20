# Musix

Musix is a free and open-source desktop player for [YouTube Music](https://music.youtube.com) on Ubuntu. It wraps the official web player in a native, dashboard-style shell with a built-in ad blocker, GNOME media controls, media keys, a tray icon, and track change notifications.

Musix is not affiliated with or endorsed by Google or YouTube. Streaming happens only through the official web player, and you sign in with your own Google account. Musix never downloads, rips, or extracts audio streams, uses no paid APIs or API keys, and sends no telemetry.

## Features

- YouTube Music in a native window with its own sidebar, top bar, player bar, queue panel, and settings, styled with Sora headings and Manrope body text.
- Ad blocking with the Ghostery engine (ads, tracking, and annoyance lists), cached on disk and refreshed every 24 hours, plus a fallback that mutes and fast-forwards ads the network blocker cannot stop.
- GNOME top bar and lock screen media controls through MPRIS, hardware media keys, a tray icon with playback controls, and desktop notifications on track change.
- Responsive layout from 360 pixels wide (bottom navigation and a Now Playing sheet) up to 2560 pixels (docked queue), with dark and light themes that follow the system.
- Keyboard shortcuts throughout, including while YouTube Music itself has focus.
- Close to tray, start on login, single instance, and remembered window size, position, and sidebar state.
- No browser look or behavior: a frameless window with its own title bar and window controls that follow the GNOME button layout, rounded corners when not maximized, overlay scrollbars that fade in while scrolling, shelf chevrons with edge fades, custom context menus (Play next, Add to queue, Like, Go to artist, Go to album, Copy link), custom tooltips and dialogs, and no reload, zoom, print, find, view-source, or devtools shortcuts.

Screenshots at every breakpoint, in both themes, are in [`docs/screenshots/desktop`](../docs/screenshots/desktop).

## Requirements

- Ubuntu 22.04 LTS or 24.04 LTS, x64, on X11 or Wayland. Musix was developed and tested on Ubuntu 26.04.
- For the tray icon: an AppIndicator host. Ubuntu ships the `ubuntu-appindicators` GNOME extension and enables it by default.
- For the AppImage only: `libfuse2` (see below).
- To build from source: Node.js 22 or newer and npm.

## Install from the .deb

```bash
sudo apt install ./musix-1.0.0-amd64.deb
```

`apt` pulls in the declared dependencies: `libnotify4`, `libayatana-appindicator3-1` (or `libappindicator3-1`), `libsecret-1-0`, `libnss3`, `libxss1`, `libasound2` (or `libasound2t64` on 24.04), and the usual GTK and X libraries. The post-install script sets the `chrome-sandbox` helper to root-owned 4755. On 24.04 and newer it also installs an AppArmor profile (`/etc/apparmor.d/musix`) that allows the Chromium sandbox to create user namespaces.

Uninstall:

```bash
sudo apt remove musix
```

Removing the package also removes the `/usr/bin/musix` alternative and the AppArmor profile. Your settings and YouTube Music session stay in `~/.config/Musix` until you delete that folder.

## Run the AppImage

```bash
chmod +x Musix-1.0.0-x86_64.AppImage
```

```bash
./Musix-1.0.0-x86_64.AppImage
```

AppImages need FUSE 2. On 22.04 install it with `sudo apt install libfuse2`. On 24.04 the package is named `libfuse2t64`:

```bash
sudo apt install libfuse2t64
```

Without FUSE you can still run it with `APPIMAGE_EXTRACT_AND_RUN=1 ./Musix-1.0.0-x86_64.AppImage`.

Sandbox note for 24.04 and newer: Ubuntu restricts unprivileged user namespaces, and an AppImage cannot install a SUID sandbox helper. The AppImage launcher detects this and starts Musix with `--no-sandbox`, so it runs without extra setup. Renderer isolation, context isolation, and the per-page sandbox flags still apply, but the operating-system level Chromium sandbox is off. If you want the full sandbox, use the .deb, which installs an AppArmor profile.

## Run from source

```bash
npm ci
```

```bash
npm run dev
```

`npm run dev` builds into `dist/` and starts Electron with the Wayland-aware `--ozone-platform-hint=auto` flag. On kernels that restrict user namespaces, the development Electron binary has no SUID sandbox helper, so the dev launcher adds `--no-sandbox` and prints a warning. Packaged builds do not need this.

npm's install-script approval can skip Electron's binary download. If `node_modules/electron/dist` is missing after `npm ci`, run `node node_modules/electron/install.js`.

## Build

| Script | What it does |
| --- | --- |
| `npm run dev` | Development build and launch |
| `npm run build` | Production bundle into `dist/` (esbuild, minified) |
| `npm run typecheck` | `tsc --noEmit` in strict mode |
| `npm run lint` | ESLint with zero warnings allowed, then Prettier check |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Builds, then runs the Playwright Electron end-to-end suite in the current desktop session |
| `npm run test:e2e:virtual` | Builds, then runs the same suite on a private Xvfb display with the openbox window manager |
| `npm run dist:deb` | Builds `release/musix-<version>-amd64.deb` |
| `npm run dist:appimage` | Builds `release/Musix-<version>-x86_64.AppImage` |
| `npm run dist` | Builds both packages |
| `npm run icons` | Regenerates the PNG icon sizes from `assets/icons/musix.svg` |
| `npm run licenses` | Regenerates `THIRD_PARTY_LICENSES.md` and fails on any disallowed license |

Packaging uses `build/electron-builder.yml`. The maintainer scripts are `build/after-install.sh` and `build/after-remove.sh`, and `build/musix.desktop` is the reference desktop entry.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Space | Play or pause (ignored while typing) |
| Ctrl + Right / Ctrl + Left | Next / previous track |
| Right / Left | Seek forward / back 10 seconds |
| Up / Down | Volume up / down 5 percent |
| M | Mute or unmute |
| L | Like the current track |
| S | Shuffle |
| R | Cycle repeat (off, all, one) |
| Ctrl + K or / | Focus search |
| Ctrl + , | Open Settings |
| Esc | Close drawers, sheets, and dialogs |
| Ctrl + Q | Quit |

Shortcuts also work while YouTube Music has keyboard focus. They are ignored while you type in any text field, in the shell or inside YouTube Music.

## How it works

- `src/main` runs the Electron main process. One `BrowserWindow` loads the local shell UI. A `WebContentsView` on the `persist:ytmusic` partition loads YouTube Music inside the shell's content area. The shell measures that area with a `ResizeObserver` and main calls `setBounds` on every change.
- Two small transparent `WebContentsView` layers render tooltips and toasts above YouTube Music, because a native view always paints over the shell's DOM. Drawers and dialogs that overlap YouTube Music show a captured frame of it while they are open, so nothing disappears behind them.
- `src/preload/ytm.ts` is the bridge injected into YouTube Music. It reads state from `navigator.mediaSession` and the player DOM, diffs it, throttles progress to 4 updates per second, runs commands, reads the queue, and handles the ad fallback.
- `src/preload/shell.ts` exposes a minimal typed API through `contextBridge`. Every IPC channel is typed in `src/shared/channels.ts`, and main validates both the sender frame and the payload shape of every message.
- `src/renderer` is the vanilla TypeScript shell: a single store with subscribe and dispatch, components, and the design system in `styles/`.

## Troubleshooting

**The app does not start and mentions the sandbox.** On 24.04 and newer, user namespaces are restricted by AppArmor. The .deb installs a profile for `/opt/Musix/musix`. Check that `/etc/apparmor.d/musix` exists and is loaded:

```bash
sudo apparmor_parser --replace /etc/apparmor.d/musix
```

Also check that `/opt/Musix/chrome-sandbox` is owned by root with mode 4755. The AppImage falls back to `--no-sandbox` automatically.

**`dlopen(): error loading libfuse.so.2`.** Install `libfuse2` (22.04) or `libfuse2t64` (24.04), or run the AppImage with `APPIMAGE_EXTRACT_AND_RUN=1`.

**Wayland.** Musix runs natively on Wayland through `--ozone-platform-hint=auto` and falls back to X11 automatically. To force X11, start it with `musix --ozone-platform=x11`. On Wayland, hardware media keys reach Musix through GNOME's MPRIS integration rather than global key grabs.

**No tray icon on GNOME.** GNOME has no tray without an extension. Ubuntu's `ubuntu-appindicators` extension is enabled by default. On other GNOME setups, install and enable `gnome-shell-extension-appindicator`. With Close to tray on and no tray host, closing the window only hides it; launch Musix again to bring it back, or turn off Close to tray in Settings.

**Duplicate media controls.** Musix uses Chromium's built-in media session for MPRIS. It starts its `mpris-service` fallback only if no media session from its own process appears within 3 seconds of playback, and it stops the fallback as soon as Chromium's appears.

**Sign-in problems.** Sign-in happens on Google's own pages in the same session as YouTube Music. To start over, use Settings, then Data, then Sign out and clear data.

## Testing

- `npm test` runs 125 unit tests: state diffing, time formatting, volume and seek math, breakpoint resolution, settings schema validation, IPC payload validators, the URL routing map, shortcut resolution, notification and MPRIS policies, autostart entries, the renderer store, WCAG contrast for both themes, a scan that rejects any CSS font size under 14px, shared-bridge command routing, GNOME button layout parsing, context menu models and placement, and browser shortcut blocking.
- `npm run test:e2e` runs the Playwright Electron suite against a local fixture that reproduces YouTube Music's player markup and APIs, so playback, queue, ads, and navigation are deterministic. Each test fails if the shell logs a console error or uncaught page error, or if main logs an error or an unhandled promise rejection.
- `npm run test:e2e:virtual` is the recommended way to run the suite. Tests in the live desktop session can be disturbed by the real mouse pointer (hover states) and by other windows taking focus. The runner needs `Xvfb` and `openbox` on `PATH`, or `MUSIX_XVFB`, `MUSIX_OPENBOX`, and `MUSIX_OPENBOX_ROOT` pointing at extracted packages.
- `E2E_SCREENSHOTS=1 node scripts/e2e-virtual.mjs tests/e2e/screenshots.spec.ts` captures the documentation screenshots from the real music.youtube.com, compositing the shell window and the embedded YouTube Music view into one image per breakpoint and theme.
- `E2E_LIVE=1 npx playwright test tests/e2e/live.spec.ts tests/e2e/desktop.spec.ts` runs against the real music.youtube.com in a desktop session. It covers playback through the bridge, MPRIS metadata and PlayPause over D-Bus, tray menu labels and clicks over dbusmenu, and notification content captured with `dbus-monitor`. It plays audio briefly; the desktop test mutes after the first track starts.
- `E2E_SOAK=1 SOAK_MINUTES=60 npx playwright test tests/e2e/soak.spec.ts` plays continuously for an hour with SPA navigation every 20 seconds and records JS heap after garbage collection, process memory, DOM size, and bridge message rates every minute.

## Verification checklist

Verified on 2026-10-20 on Ubuntu 26.04 (GNOME Shell 50.1, Wayland), Electron 44.9.0.

| Item | Result | How it was checked |
| --- | --- | --- |
| Sign in persists after restart | Not verified | Needs a real Google account. The session lives in the persistent `persist:ytmusic` partition, and settings persistence across restarts is covered by `settings.spec.ts`. |
| Pre-roll and mid-roll ads blocked or skipped | Partially verified | Real YouTube Music sessions blocked 18 to 19 ad and tracking requests in about 45 seconds. No ad played in the live sessions, so the skip path was verified against the fixture: skippable ads are clicked through, and unskippable ads are muted and fast-forwarded (`ads.spec.ts`). |
| GNOME media controls and lock screen | Verified at the D-Bus level | `desktop.spec.ts`: MPRIS identity `Musix`, title, artist, album, length, and artwork are published, and PlayPause from D-Bus pauses and resumes playback. I did not look at the GNOME panel or the lock screen on screen. |
| Media keys while unfocused | Verified at the D-Bus level | GNOME routes media keys to the active MPRIS player, and the MPRIS PlayPause and Next calls work. I did not press physical keys. |
| Tray menu reflects the current track and works | Verified | `desktop.spec.ts`: the dbusmenu labels show the track and Play/Pause state, and clicking Pause and Play from the menu controls playback. |
| Notifications show correct art and text | Verified | `desktop.spec.ts`: the Notify call carries the new track's title, artist and album, `image-data` artwork, and the `musix` desktop entry. Suppression while the window is focused or an ad plays is covered by `policies.test.ts`. |
| Every text element 14px or larger, Sora headings, Manrope elsewhere | Verified | `app.spec.ts` checks every rendered text element, and `design-tokens.test.ts` scans all CSS. |
| Dark and light themes pass contrast checks | Verified | `design-tokens.test.ts` checks 16 foreground and background pairs per theme against WCAG AA (4.5:1). |
| .deb installs and uninstalls cleanly on 22.04 and 24.04 | Not verified | No 22.04 or 24.04 machine and no root access were available. The built package was inspected: control fields, dependency alternatives, maintainer scripts, desktop entry, icons, and asar contents. The AppArmor profile was validated with `apparmor_parser`. |
| AppImage runs on 22.04 and 24.04 | Not verified on those releases | On 26.04 the AppImage starts and loads YouTube Music through `APPIMAGE_EXTRACT_AND_RUN=1` (libfuse2 is not installed there), using the automatic `--no-sandbox` fallback. |

### Quality gates

| Gate | Result |
| --- | --- |
| `tsc --noEmit` | 0 errors |
| ESLint | 0 errors, 0 warnings |
| Unit tests | 125 passed |
| End-to-end tests (fixture) | 57 passed (includes 14 native-behavior tests for scrollbars, shelves, window chrome, context menus, shortcuts, tooltips, dialogs, selection, and focus) |
| Live and desktop tests | 2 passed |
| Shell and main console errors | None across the full end-to-end run (each test asserts it) |
| Unhandled promise rejections | None (each test asserts it) |
| 60 minute playback soak | See `SOAK_RESULTS.md` |

## License

Musix is released under the MIT License (see `LICENSE`). Third-party packages and their licenses are listed in `THIRD_PARTY_LICENSES.md`. Every shipped dependency is MIT, MPL-2.0, Apache-2.0, BSD, ISC, or OFL. The Sora and Manrope fonts are under the SIL Open Font License 1.1, and the icons are from Lucide (ISC).
