import {defineConfig} from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT || 8765);

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {},
    trace: 'retain-on-failure',
  },
  projects: [
    {name: 'desktop', use: {viewport: {width: 1280, height: 900}}},
    {name: 'mobile', use: {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}},
  ],
  webServer: {command: `npm run build:web && node scripts/serve.mjs --port ${port}`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI},
});
