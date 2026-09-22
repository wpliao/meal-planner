import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'on-first-retry' },
  expect: {
    toHaveScreenshot: {
      // Absorbs font antialiasing differences between the Dev Container and
      // the CI runner, while staying far below the scale of a real styling
      // regression — the Phase 2 defects changed whole controls, not edges.
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },
  projects: [
    {
      name: 'chromium-desktop',
      testIgnore: /(security-headers|shell-fallback)\.spec\.ts/u,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:5173',
      },
    },
    {
      name: 'chromium-mobile',
      testIgnore: /(security-headers|shell-fallback)\.spec\.ts/u,
      use: {
        ...devices['Pixel 7'],
        baseURL: 'http://127.0.0.1:5174',
      },
    },
    {
      name: 'webkit-desktop',
      testIgnore: /(security-headers|shell-fallback)\.spec\.ts/u,
      use: {
        ...devices['Desktop Safari'],
        baseURL: 'http://127.0.0.1:5175',
      },
    },
    {
      // iOS is half the family's devices, and Chromium at a phone viewport
      // does not render like Safari — form controls especially.
      name: 'webkit-mobile',
      testIgnore: /(security-headers|shell-fallback)\.spec\.ts/u,
      use: {
        ...devices['iPhone 15'],
        baseURL: 'http://127.0.0.1:5176',
      },
    },
    {
      // The production build served through the real Cloudflare asset
      // pipeline, which is the only place `public/_headers` takes effect.
      name: 'asset-pipeline',
      testMatch: /(security-headers|shell-fallback)\.spec\.ts/u,
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
      command: 'pnpm dev:e2e -- --port 5175',
      url: 'http://127.0.0.1:5175/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev:e2e -- --port 5176',
      url: 'http://127.0.0.1:5176/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Rebuild so the served assets always match the working tree. Bind the
      // host explicitly: the default `localhost` can resolve to ::1 on CI
      // while Playwright polls 127.0.0.1. `--strictPort` fails loudly instead
      // of silently drifting to another port.
      command:
        'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175/',
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 120_000,
    },
  ],
});
