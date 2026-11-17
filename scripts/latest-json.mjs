// Release helper: writes latest.json (in-app update check) and sidestore.json (iPhone
// updates through SideStore/AltStore) into the given folder. Upload both with every release:
//   node scripts/latest-json.mjs <folder-with-the-release-files>
import { execSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? '.';
const repo = 'https://github.com/amvprosox/musixGoogle';
const version = JSON.parse(readFileSync('desktop/package.json', 'utf8')).version;
const iosBuild = Number(/CURRENT_PROJECT_VERSION: "(\d+)"/.exec(readFileSync('ios/project.yml', 'utf8'))?.[1] ?? 0);
const androidVersionCode = Number(/versionCode = (\d+)/.exec(readFileSync('android/app/build.gradle.kts', 'utf8'))?.[1] ?? 0);
const desktopBuild = Number(execSync('git log -1 --format=%ct', { encoding: 'utf8' }).trim());
const files = {
  mac: `Musix-${version}-mac.dmg`,
  macZip: `Musix-${version}-mac.zip`,
  windows: `Musix-Setup-${version}.exe`,
  linux: `Musix-${version}-x86_64.AppImage`,
  android: `Musix-${version}-android.apk`,
  ios: `Musix-${version}-ios.ipa`,
};
const write = (name, value) => writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);
write('latest.json', { version, desktopBuild, iosBuild, androidVersionCode, files });

let ipaSize = 0;
try {
  ipaSize = statSync(path.join(out, files.ios)).size;
} catch {
  // The .ipa is not in the folder; SideStore still works without the size.
}
const icon = 'https://raw.githubusercontent.com/amvprosox/musixGoogle/main/ios/Musix/Resources/Assets.xcassets/Logo.imageset/Logo.png';
write('sidestore.json', {
  name: 'Musix',
  identifier: 'com.realmadhoney.musix.source',
  subtitle: 'YouTube Music player with offline downloads and voice control',
  iconURL: icon,
  website: repo,
  tintColor: '4F46E5',
  apps: [
    {
      name: 'Musix',
      bundleIdentifier: 'com.realmadhoney.musix',
      developerName: 'amvprosox',
      subtitle: 'Music without ads, online and offline',
      localizedDescription: 'Musix plays YouTube Music without ads, downloads songs for offline listening, and has the Veru voice assistant.',
      iconURL: icon,
      tintColor: '4F46E5',
      category: 'entertainment',
      versions: [
        {
          version,
          buildVersion: String(iosBuild),
          date: new Date().toISOString().slice(0, 10),
          localizedDescription: `Musix ${version} (build ${iosBuild})`,
          downloadURL: `${repo}/releases/download/v${version}/${files.ios}`,
          size: ipaSize,
          minOSVersion: '16.0',
        },
      ],
      appPermissions: { entitlements: [], privacy: {} },
    },
  ],
  news: [],
});
