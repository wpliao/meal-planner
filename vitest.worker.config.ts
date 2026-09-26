import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

import { parseDataset } from './src/operations/nutrition-dataset/dataset.ts';
import {
  dataStatements,
  finishStatements,
} from './src/operations/nutrition-dataset/statements.ts';

const migrations = await readD1Migrations('./migrations');

// The nutrition fixture, as the same SQL the Deploy load step runs.
const fixtureText = readFileSync(
  './test/fixtures/nutrition-dataset.json',
  'utf8',
);
const fixture = parseDataset(fixtureText);
const nutritionStatements = [
  ...dataStatements(fixture),
  ...finishStatements(
    fixture,
    createHash('sha256').update(fixtureText).digest('hex'),
    '2026-09-26T00:00:00.000Z',
  ),
];

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          TEST_NUTRITION_STATEMENTS: nutritionStatements,
        },
      },
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
