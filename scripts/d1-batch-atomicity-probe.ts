/**
 * Operator entry point for the D1 REST batch atomicity probe (#32 gate 2).
 * Run it only through `.github/workflows/d1-batch-atomicity-probe.yml`; see
 * `docs/operations/household-decommission.md`.
 *
 * Node 24 runs this file directly with its built-in type stripping.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { runProbeCli } from '../src/operations/household-decommission/probe-cli.ts';

process.exitCode = await runProbeCli({
  env: process.env,
  readWranglerConfig: () =>
    readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  fetch: (input, init) => fetch(input, init),
  log: (line) => {
    console.log(line);
  },
  now: () => new Date(),
  newId: () => randomUUID(),
});
