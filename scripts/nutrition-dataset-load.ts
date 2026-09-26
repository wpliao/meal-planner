/**
 * Loads `data/nutrition/usda-fdc.json` into an environment's D1 database when
 * it doesn't already hold that exact file. Deploy runs it after migrations;
 * the local development and E2E scripts run it too.
 *
 *   node scripts/nutrition-dataset-load.ts --remote
 *   node scripts/nutrition-dataset-load.ts --local [--persist-to <dir>] [--dataset <file>]
 *
 * The environment comes from CLOUDFLARE_ENV, as for the migration step.
 * Node 24 runs this file with type stripping.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { loadNutritionDataset } from '../src/operations/nutrition-dataset/load.ts';

const { values } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    remote: { type: 'boolean', default: false },
    'persist-to': { type: 'string' },
    dataset: {
      type: 'string',
      default: new URL('../data/nutrition/usda-fdc.json', import.meta.url)
        .pathname,
    },
  },
});
if (values.local === values.remote) {
  throw new Error('Pass exactly one of --local or --remote.');
}

const target = values.remote
  ? ['--remote']
  : [
      '--local',
      ...(values['persist-to'] ? ['--persist-to', values['persist-to']] : []),
    ];

const wrangler = (args: string[]): unknown => {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'execute',
      'DB',
      ...target,
      '--json',
      // A remote file import asks for confirmation; Deploy can't answer.
      '--yes',
      ...args,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    // Wrangler's JSON error names the failing statement, not a secret.
    throw new Error(
      `wrangler d1 execute failed: ${result.stdout}${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as unknown;
};

/** The rows of the last result Wrangler reports. */
const lastRows = (output: unknown): Record<string, unknown>[] => {
  const results = Array.isArray(output) ? output : [];
  const last = results.at(-1) as
    { results?: Record<string, unknown>[] } | undefined;
  return last?.results ?? [];
};

const datasetText = readFileSync(values.dataset, 'utf8');
const directory = mkdtempSync(join(tmpdir(), 'nutrition-load-'));

await loadNutritionDataset({
  datasetText,
  sha256: createHash('sha256').update(datasetText).digest('hex'),
  runner: {
    command: (sql) => Promise.resolve(lastRows(wrangler(['--command', sql]))),
    file: (path) => {
      wrangler(['--file', path]);
      return Promise.resolve();
    },
  },
  writeSqlFile: (sql) => {
    const path = join(directory, 'nutrition-dataset.sql');
    writeFileSync(path, sql);
    return Promise.resolve(path);
  },
  now: () => new Date(),
  log: (line) => {
    console.log(line);
  },
});
