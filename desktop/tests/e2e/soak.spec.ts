import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeApp, launchApp, viewEval } from './helpers';
import { startFixtureServer } from './fixture/server';
import { expect, test, waitForView } from './test';

const minutes = Number.parseInt(process.env.SOAK_MINUTES ?? '60', 10);

test.skip(process.env.E2E_SOAK !== '1', 'Set E2E_SOAK=1 to run the long playback soak test');
test.setTimeout((minutes + 10) * 60 * 1000);

interface Sample {
  minute: number;
  shellHeapMb: number;
  viewHeapMb: number;
  totalWorkingSetMb: number;
  stateMessages: number;
  queueMessages: number;
  domNodes: number;
}

test(`no memory growth or listener duplication over ${minutes} minutes of playback`, async () => {
  const server = await startFixtureServer();
  const launched = await launchApp({ ytmUrl: server.url, extraArgs: ['--js-flags=--expose-gc'] });
  const { shell, app } = launched;
  const samples: Sample[] = [];
  try {
    await waitForView(app, shell, server.url);
    await app.evaluate(({ ipcMain }) => {
      const counters = { state: 0, queue: 0 };
      (globalThis as unknown as { __soak: typeof counters }).__soak = counters;
      ipcMain.on('ytm:message', (_event, raw: unknown) => {
        if (typeof raw !== 'string') {
          return;
        }
        if (raw.includes('"type":"state"')) {
          counters.state += 1;
        } else if (raw.includes('"type":"queue"')) {
          counters.queue += 1;
        }
      });
    });
    await viewEval(app, `document.querySelector('.repeat').click(); window.__fixture.play(0)`);
    const routes = ['explore', 'library', 'liked', 'playlists', 'home'];
    const started = Date.now();
    let minute = 0;
    while (Date.now() - started < minutes * 60 * 1000) {
      for (let step = 0; step < 3; step += 1) {
        for (const route of routes) {
          await shell.locator(`#sidebar [data-nav="${route}"]`).click();
          await shell.waitForTimeout(400);
        }
        await shell.locator('#queue-toggle').click();
        await shell.locator('#queue-toggle').click();
        await shell.waitForTimeout(20000 - routes.length * 400);
      }
      minute += 1;
      const counters = await app.evaluate(() => {
        const soak = (globalThis as unknown as { __soak: { state: number; queue: number } }).__soak;
        const snapshot = { ...soak };
        soak.state = 0;
        soak.queue = 0;
        return snapshot;
      });
      const shellHeap = await shell.evaluate(() => {
        const g = (globalThis as unknown as { gc?: () => void }).gc;
        if (g) {
          g();
        }
        return (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
      });
      const view = await viewEval<{ heap: number; nodes: number }>(
        app,
        `(() => { if (typeof gc === 'function') { gc(); } return { heap: performance.memory.usedJSHeapSize, nodes: document.getElementsByTagName('*').length }; })()`,
      );
      const workingSet = await app.evaluate(({ app: electronApp }) =>
        electronApp.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
      );
      const sample: Sample = {
        minute,
        shellHeapMb: Math.round((shellHeap / 1048576) * 100) / 100,
        viewHeapMb: Math.round((view.heap / 1048576) * 100) / 100,
        totalWorkingSetMb: Math.round((workingSet / 1024) * 10) / 10,
        stateMessages: counters.state,
        queueMessages: counters.queue,
        domNodes: view.nodes,
      };
      samples.push(sample);
      console.info(JSON.stringify(sample));
      const status = await viewEval<{ paused: boolean }>(app, 'window.__fixture.status()');
      expect(status.paused).toBe(false);
    }
  } finally {
    const report = process.env.SOAK_REPORT ?? path.join(process.cwd(), 'test-results', 'soak-report.json');
    mkdirSync(path.dirname(report), { recursive: true });
    writeFileSync(report, JSON.stringify({ minutes, samples }, null, 2));
    await closeApp(launched);
    await server.close();
  }
  const baseline = samples[Math.min(4, samples.length - 1)];
  const last = samples[samples.length - 1];
  expect(baseline).toBeDefined();
  expect(last).toBeDefined();
  if (baseline && last) {
    expect(last.shellHeapMb - baseline.shellHeapMb).toBeLessThan(5);
    expect(last.viewHeapMb - baseline.viewHeapMb).toBeLessThan(5);
    expect(last.domNodes).toBeLessThanOrEqual(baseline.domNodes + 50);
  }
  for (const sample of samples) {
    expect(sample.stateMessages).toBeLessThanOrEqual(300);
  }
});
