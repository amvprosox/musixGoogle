import { promises as fs } from 'node:fs';
import os from 'node:os';
import { posix as path } from 'node:path';

export interface AutostartEntryOptions {
  name: string;
  comment: string;
  exec: string[];
  icon: string;
  wmClass: string;
}

export function quoteExecArg(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) {
    return arg;
  }
  const escaped = arg.replace(/(["`$\\])/g, '\\$1');
  return `"${escaped}"`;
}

export function buildAutostartEntry(options: AutostartEntryOptions): string {
  const exec = options.exec.map(quoteExecArg).join(' ');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${options.name}`,
    `Comment=${options.comment}`,
    `Exec=${exec}`,
    `Icon=${options.icon}`,
    `StartupWMClass=${options.wmClass}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'X-GNOME-Autostart-Delay=3',
    '',
  ].join('\n');
}

export function autostartDir(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME;
  const base =
    typeof configHome === 'string' && configHome.trim() !== '' && path.isAbsolute(configHome)
      ? configHome
      : path.join(os.homedir(), '.config');
  return path.join(base, 'autostart');
}

export function autostartFile(desktopName: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(autostartDir(env), `${desktopName}.desktop`);
}

export async function writeAutostart(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents, { mode: 0o644 });
}

export async function removeAutostart(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function autostartExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
