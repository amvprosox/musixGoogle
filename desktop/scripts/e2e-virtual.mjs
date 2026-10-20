import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const display = process.env.E2E_DISPLAY ?? ':97';
const xvfb = process.env.MUSIX_XVFB ?? 'Xvfb';
const openbox = process.env.MUSIX_OPENBOX ?? 'openbox';
const openboxRoot = process.env.MUSIX_OPENBOX_ROOT ?? '';

function which(command) {
  if (command.includes('/')) {
    return existsSync(command);
  }
  return spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
}

if (!which(xvfb)) {
  console.error(`Xvfb was not found. Install the xvfb package or set MUSIX_XVFB to its path.`);
  process.exit(2);
}

const server = spawn(xvfb, [display, '-screen', '0', '2600x1700x24', '-nolisten', 'tcp'], {
  stdio: 'ignore',
});
const children = [server];
await new Promise((resolve) => setTimeout(resolve, 800));

if (which(openbox)) {
  const env = { ...process.env, DISPLAY: display };
  if (openboxRoot !== '') {
    env.LD_LIBRARY_PATH = path.join(openboxRoot, 'usr/lib/x86_64-linux-gnu');
    env.XDG_DATA_DIRS = `${path.join(openboxRoot, 'usr/share')}:/usr/share`;
    env.XDG_CONFIG_DIRS = path.join(openboxRoot, 'etc/xdg');
  }
  children.push(spawn(openbox, ['--sm-disable'], { stdio: 'ignore', env }));
  await new Promise((resolve) => setTimeout(resolve, 800));
} else {
  console.warn('openbox was not found; window maximize tests need a window manager.');
}

const stop = () => {
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
    }
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const run = spawn('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, E2E_DISPLAY: display },
});
run.on('exit', (code) => {
  stop();
  process.exit(code ?? 1);
});
