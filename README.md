# Musix

A YouTube Music player for Ubuntu, Windows, Android (with Android Auto) and iOS, with a built-in ad blocker.

## Download

Open the [Actions tab](https://github.com/amvprosox/musixGoogle/actions), click the latest green **Build** run, and download from **Artifacts** (you must be signed in to GitHub):

| Platform | Artifact | File |
| --- | --- | --- |
| Windows | `Musix-Windows` | `Musix-Setup-1.0.0.exe` or `Musix-Portable-1.0.0.exe` |
| Android | `Musix-Android-APKs` | `Musix-android-phone.apk` |
| Android Automotive | `Musix-Android-APKs` | `Musix-android-automotive.apk` |
| iOS | `Musix-iOS-unsigned-ipa` | `Musix-unsigned.ipa` |

Unzip the downloaded artifact to get the file.

## Install on Ubuntu

```bash
git clone https://github.com/amvprosox/musixGoogle.git
cd musixGoogle
npm ci
npm run build:shared
npm run dist:deb -w musix
sudo apt install ./desktop/release/musix-1.0.0-amd64.deb
```

Open **Musix** from the app grid.

## Install on Windows

1. Run `Musix-Setup-1.0.0.exe`.
2. If SmartScreen appears, click **More info** then **Run anyway**.
3. Open **Musix** from the Start menu.

`Musix-Portable-1.0.0.exe` runs without installing.

## Install on Android

1. Copy `Musix-android-phone.apk` to the phone and open it.
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
4. Select `Musix-unsigned.ipa`, choose your iPhone and click **Install**.
5. On the iPhone, open **Settings > Privacy & Security > Developer Mode**, turn it on and restart.
6. Open **Settings > General > VPN & Device Management**, tap your Apple ID and tap **Trust**.
7. Open **Musix**.

## License

MIT. See [LICENSE](LICENSE).
