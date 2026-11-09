import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  webServer: { command: 'node tests/e2e/server.mjs', port: 4517, reuseExistingServer: true },
});
