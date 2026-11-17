// Writes latest.json for the in-app update check. Upload it to every release with the
// installers: node scripts/latest-json.mjs > latest.json
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync('desktop/package.json', 'utf8')).version;
const iosBuild = Number(
  /CURRENT_PROJECT_VERSION: "(\d+)"/.exec(readFileSync('ios/project.yml', 'utf8'))?.[1] ?? 0,
);
const androidVersionCode = Number(
  /versionCode = (\d+)/.exec(readFileSync('android/app/build.gradle.kts', 'utf8'))?.[1] ?? 0,
);
const desktopBuild = Number(execSync('git log -1 --format=%ct', { encoding: 'utf8' }).trim());
const files = {
  mac: `Musix-${version}-mac.dmg`,
  windows: `Musix-Setup-${version}.exe`,
  linux: `Musix-${version}-x86_64.AppImage`,
  android: `Musix-${version}-android.apk`,
  ios: `Musix-${version}-ios.ipa`,
};
process.stdout.write(
  `${JSON.stringify({ version, desktopBuild, iosBuild, androidVersionCode, files }, null, 2)}\n`,
);
