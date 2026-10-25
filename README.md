# Musix

A custom music YouTube app with a built-in ad blocker to play what music you wanted to play without subscribing to YouTube 😛. Similar to Youtube Revanced

## Download

Get the files from the [latest release](https://github.com/amvprosox/musixGoogle/releases/latest):

| Platform | File |
| --- | --- |
| Ubuntu | `Musix-1.0.4-amd64.deb` or `Musix-1.0.4-x86_64.AppImage` |
| Windows | `Musix-Setup-1.0.4.exe` or `Musix-Portable-1.0.4.exe` |
| macOS | `Musix-1.0.4-mac.dmg` or `Musix-1.0.4-mac.zip` |
| Android | `Musix-1.0.4-android.apk` |
| Android Automotive | `Musix-1.0.4-android-automotive.apk` |
| iOS | `Musix-1.0.4-ios.ipa` |

## Install on Ubuntu

```bash
sudo apt install ./Musix-1.0.4-amd64.deb
```

Run this in the folder where you downloaded the file, then open **Musix** from the app grid.

To use the AppImage instead:

```bash
chmod +x Musix-1.0.4-x86_64.AppImage
./Musix-1.0.4-x86_64.AppImage
```

## Install on Windows

1. Run `Musix-Setup-1.0.4.exe`.
2. If SmartScreen appears, click **More info** then **Run anyway**.
3. Open **Musix** from the Start menu.

`Musix-Portable-1.0.4.exe` runs without installing.

## Install on macOS

Works on macOS 12 or newer, on both Apple Silicon and Intel Macs.

1. Open `Musix-1.0.4-mac.dmg` and drag **Musix** into **Applications**.
2. Run this once in Terminal so macOS allows the app:

```bash
xattr -dr com.apple.quarantine /Applications/Musix.app
```

3. Open **Musix** from Applications or Launchpad.

## Install on Android

1. Copy `Musix-1.0.4-android.apk` to the phone and open it.
2. Allow installs from that source when asked, then tap **Install**.
3. Open **Musix** and sign in.

### Android Auto

1. Open **Settings > Apps > Android Auto > Additional settings in the app** (or open the Android Auto app).
2. Tap **Version** 10 times to unlock developer mode.
3. Open the menu, tap **Developer settings**, and turn on **Unknown sources**.
4. Connect to the car; Musix appears in the Android Auto app launcher.

## Install on iPhone

Requires a computer, a USB cable and a free Apple ID. The app must be reinstalled every 7 days.

1. Download [Impactor](https://github.com/claration/impactor/releases) for your computer.
2. Plug in the iPhone, unlock it and tap **Trust**.
3. Open Impactor, sign in with your Apple ID and enter the code shown on the iPhone.
4. Select `Musix-1.0.4-ios.ipa`, choose your iPhone and click **Install**.
5. On the iPhone, open **Settings > Privacy & Security > Developer Mode**, turn it on and restart.
6. Open **Settings > General > VPN & Device Management**, tap your Apple ID and tap **Trust**.
7. Open **Musix**.

## License

MIT. See [LICENSE](LICENSE).
