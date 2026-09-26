import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
  type Project,
} from '@playwright/test';

type WebServer = Exclude<
  NonNullable<PlaywrightTestConfig['webServer']>,
  readonly unknown[]
>;

const devServer = (port: number) => ({
  command: `pnpm dev:e2e -- --port ${port}`,
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: false,
  timeout: 120_000,
});

const APP_SPECS = /(security-headers|shell-fallback)\.spec\.ts/u;

/** Each project with the one server it tests against. */
const targets = [
  {
    project: {
      name: 'chromium-desktop',
      testIgnore: APP_SPECS,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5173' },
    },
    server: devServer(5173),
  },
  {
    project: {
      name: 'chromium-mobile',
      testIgnore: APP_SPECS,
      use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:5174' },
    },
    server: devServer(5174),
  },
  {
    project: {
      name: 'webkit-desktop',
      testIgnore: APP_SPECS,
      use: { ...devices['Desktop Safari'], baseURL: 'http://127.0.0.1:5175' },
    },
    server: devServer(5175),
  },
  {
    // iOS is half the family's devices, and Chromium at a phone viewport
    // does not render like Safari — form controls especially.
    project: {
      name: 'webkit-mobile',
      testIgnore: APP_SPECS,
      use: { ...devices['iPhone 15'], baseURL: 'http://127.0.0.1:5176' },
    },
    server: devServer(5176),
  },
  {
    // The production build served through the real Cloudflare asset
    // pipeline, which is the only place `public/_headers` takes effect.
    project: {
      name: 'asset-pipeline',
      testMatch: APP_SPECS,
      use: { baseURL: 'http://127.0.0.1:4175' },
    },
    // Rebuild so the served assets always match the working tree. Bind the
    // host explicitly: the default `localhost` can resolve to ::1 on CI
    // while Playwright polls 127.0.0.1. `--strictPort` fails loudly instead
    // of silently drifting to another port.
    server: {
      command:
        'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175/',
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 120_000,
    },
  },
] satisfies { project: Project; server: WebServer }[];

/**
 * `E2E_PROJECTS` (comma-separated project names) runs only those projects
 * and starts only their servers, so CI can give each browser its own job.
 * Unset, every project runs, as in `./scripts/verify.sh`.
 */
const selectTargets = (names: string | undefined) => {
  if (!names) return targets;
  const wanted = names.split(',').map((name) => name.trim());
  const unknown = wanted.filter(
    (name) => !targets.some(({ project }) => project.name === name),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown E2E_PROJECTS: ${unknown.join(', ')}`);
  }
  return targets.filter(({ project }) => wanted.includes(project.name));
};

const selected = selectTargets(process.env.E2E_PROJECTS);

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
  projects: selected.map(({ project }) => project),
  webServer: selected.map(({ server }) => server),
});
