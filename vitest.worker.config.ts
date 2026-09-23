import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    include: ['test/worker/**/*.test.ts'],
    // Refuses any real outbound request; see the file for why this exists.
    setupFiles: ['./test/worker/setup.ts'],
    coverage: {
      provider: 'istanbul',
      reportsDirectory: './coverage/worker',
      reporter: ['text', 'lcov'],
      include: ['src/worker/**/*.ts'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
