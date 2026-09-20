import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:5173',
      },
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
        baseURL: 'http://127.0.0.1:5174',
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm dev:e2e -- --port 5173',
      url: 'http://127.0.0.1:5173/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev:e2e -- --port 5174',
      url: 'http://127.0.0.1:5174/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
