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
      testIgnore: /security-headers\.spec\.ts/u,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:5173',
      },
    },
    {
      name: 'chromium-mobile',
      testIgnore: /security-headers\.spec\.ts/u,
      use: {
        ...devices['Pixel 7'],
        baseURL: 'http://127.0.0.1:5174',
      },
    },
    {
      // The production build served through the real Cloudflare asset
      // pipeline, which is the only place `public/_headers` takes effect.
      name: 'asset-pipeline',
      testMatch: /security-headers\.spec\.ts/u,
      use: { baseURL: 'http://127.0.0.1:4175' },
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
    {
      // Rebuild so the served assets always match the working tree.
      command: 'pnpm build && pnpm exec vite preview --port 4175',
      url: 'http://127.0.0.1:4175/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
