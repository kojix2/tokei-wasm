import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/extensions',
  outputDir: './test-results-extensions',
  workers: 1,
  timeout: 30_000,
  use: {trace: 'retain-on-failure'},
});
