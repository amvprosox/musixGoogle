import { defineConfig } from '@playwright/test';

const workers = Number.parseInt(process.env.E2E_WORKERS ?? '1', 10);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: Number.isFinite(workers) && workers > 0 ? workers : 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: process.env.E2E_OUTPUT ?? 'test-results',
  use: {
    trace: 'retain-on-failure',
  },
});
