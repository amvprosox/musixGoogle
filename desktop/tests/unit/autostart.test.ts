import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  autostartDir,
  autostartExists,
  autostartFile,
  buildAutostartEntry,
  quoteExecArg,
  removeAutostart,
  writeAutostart,
} from '../../src/main/autostart';

describe('autostart desktop entry', () => {
  it('quotes exec arguments per the desktop entry spec', () => {
    expect(quoteExecArg('/opt/Musix/musix')).toBe('/opt/Musix/musix');
    expect(quoteExecArg('/home/me/My Apps/Musix.AppImage')).toBe('"/home/me/My Apps/Musix.AppImage"');
    expect(quoteExecArg('a"b$c')).toBe('"a\\"b\\$c"');
  });

  it('builds a valid entry', () => {
    const entry = buildAutostartEntry({
      name: 'Musix',
      comment: 'Player',
      exec: ['/opt/Musix/musix', '--hidden'],
      icon: 'musix',
      wmClass: 'Musix',
    });
    expect(entry).toContain('[Desktop Entry]');
    expect(entry).toContain('Exec=/opt/Musix/musix --hidden');
    expect(entry).toContain('X-GNOME-Autostart-enabled=true');
  });

  it('respects XDG_CONFIG_HOME', () => {
    expect(autostartDir({ XDG_CONFIG_HOME: '/tmp/cfg' })).toBe('/tmp/cfg/autostart');
    expect(autostartDir({ XDG_CONFIG_HOME: 'relative' })).toBe(
      path.join(os.homedir(), '.config', 'autostart'),
    );
    expect(autostartFile('musix', { XDG_CONFIG_HOME: '/tmp/cfg' })).toBe('/tmp/cfg/autostart/musix.desktop');
  });

  it('writes and removes the file', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'musix-autostart-'));
    const file = autostartFile('musix', { XDG_CONFIG_HOME: dir });
    await writeAutostart(file, 'content');
    expect(readFileSync(file, 'utf8')).toBe('content');
    expect(await autostartExists(file)).toBe(true);
    await removeAutostart(file);
    expect(await autostartExists(file)).toBe(false);
    await removeAutostart(file);
  });
});
