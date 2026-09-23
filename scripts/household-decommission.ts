/**
 * Operator entry point for the household decommission procedure. Run it only
 * through `.github/workflows/household-decommission.yml`; see
 * `docs/operations/household-decommission.md`.
 *
 * Node 24 runs this file directly with its built-in type stripping.
 */
import { readdir, readFile } from 'node:fs/promises';

import { runCli } from '../src/operations/household-decommission/cli.ts';

const repositoryRoot = new URL('../', import.meta.url);

process.exitCode = await runCli({
  env: process.env,
  readWranglerConfig: () =>
    readFile(new URL('wrangler.jsonc', repositoryRoot), 'utf8'),
  listMigrationFiles: () => readdir(new URL('migrations/', repositoryRoot)),
  fetch: (input, init) => fetch(input, init),
  log: (line) => {
    console.log(line);
  },
  now: () => new Date(),
});
