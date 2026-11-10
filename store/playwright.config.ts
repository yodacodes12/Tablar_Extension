import { defineConfig } from '@playwright/test';

// Generates store screenshots (not a test suite). Run: npm run store:screenshots
export default defineConfig({
  testDir: '.',
  testMatch: 'screenshots.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
});
