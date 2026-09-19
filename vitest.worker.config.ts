import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['test/worker/**/*.test.ts'],
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
