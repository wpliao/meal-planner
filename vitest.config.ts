import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/worker/**'],
    coverage: {
      provider: 'istanbul',
      reportsDirectory: './coverage/client',
      reporter: ['text', 'lcov'],
      include: ['src/client/**/*.{ts,tsx}'],
      exclude: ['src/client/**/*.test.{ts,tsx}'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
