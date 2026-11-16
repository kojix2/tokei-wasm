import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:8765',
    launchOptions: process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {},
    trace: 'retain-on-failure',
  },
  projects: [
    {name: 'desktop', use: {viewport: {width: 1280, height: 900}}},
    {name: 'mobile', use: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}},
  ],
  webServer: {command: 'node scripts/serve.mjs --port 8765', url: 'http://127.0.0.1:8765', reuseExistingServer: !process.env.CI},
});
