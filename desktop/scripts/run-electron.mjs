import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const root = path.resolve(import.meta.dirname, '..');

function usernsAllowed() {
  try {
    return readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() !== '1';
  } catch {
    return true;
  }
}

export function sandboxArgs() {
  const sandbox = path.join(path.dirname(electronBinary), 'chrome-sandbox');
  let suid = false;
  if (existsSync(sandbox)) {
    const stats = statSync(sandbox);
    suid = stats.uid === 0 && (stats.mode & 0o4000) !== 0;
  }
  if (suid || usernsAllowed()) {
    return [];
  }
  console.warn(
    'Development Electron has no SUID sandbox helper and this kernel restricts user namespaces. Starting with --no-sandbox for local development only. Packaged builds configure the sandbox at install time.',
  );
  return ['--no-sandbox'];
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = [...sandboxArgs(), '--ozone-platform-hint=auto', root, ...process.argv.slice(2)];
  const child = spawn(electronBinary, args, { stdio: 'inherit', env: process.env });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }
  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
