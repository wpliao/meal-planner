import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          setupFiles: ['./test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/worker/**'],
        },
      },
      {
        // Operator scripts run in Node, never in a browser, and must never
        // reach the network: their tests inject a fake Cloudflare API.
        test: {
          name: 'operations',
          environment: 'node',
          include: ['test/operations/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'istanbul',
      reportsDirectory: './coverage/client',
      reporter: ['text', 'lcov'],
      include: ['src/client/**/*.{ts,tsx}', 'src/operations/**/*.ts'],
      exclude: ['src/**/*.test.{ts,tsx}'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
