import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'journeys.hosted.test.ts',
  globalSetup: './activation-block.ts',
  outputDir: '../.local/browser-evidence',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  maxFailures: 1,
  timeout: 30000,
  expect: { timeout: 3000 },
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
    serviceWorkers: 'block',
    locale: 'en-GB',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    trace: 'on',
    launchOptions: {
      executablePath: '/ms-playwright/chromium-1248/chrome-linux64/chrome',
      chromiumSandbox: true,
    },
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
    },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
