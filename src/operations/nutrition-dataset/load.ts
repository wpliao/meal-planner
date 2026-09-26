/**
 * Loads the committed nutrition dataset into one environment's D1 when that
 * environment doesn't already hold it (decision 1 of the #84 design). The
 * Wrangler calls are injected, so tests run the procedure against a fake.
 */

import { parseDataset } from './dataset.ts';
import {
  dataStatements,
  finishStatements,
  INDEX_CHECK_STATEMENT,
  LOADED_VERSION_QUERY,
  VERIFY_QUERY,
} from './statements.ts';

export interface D1Runner {
  /** Runs one SQL statement and returns the rows of its result. */
  command: (sql: string) => Promise<Record<string, unknown>[]>;
  /** Runs a file of SQL statements. */
  file: (path: string) => Promise<void>;
}

export interface LoadDependencies {
  datasetText: string;
  /** The SHA-256 of `datasetText`, in hex. */
  sha256: string;
  runner: D1Runner;
  /** Writes SQL to a temporary file and returns its path. */
  writeSqlFile: (sql: string) => Promise<string>;
  now: () => Date;
  log: (line: string) => void;
}

export type LoadOutcome = 'up_to_date' | 'loaded';

/**
 * Loads the dataset unless the database already records this exact file.
 * Order: the data file (which first deletes the version row), the index
 * rebuild, the version row, then the index integrity check and the counts.
 * Any failure throws, and the next run loads again.
 */
export const loadNutritionDataset = async (
  deps: LoadDependencies,
): Promise<LoadOutcome> => {
  const dataset = parseDataset(deps.datasetText);
  const [loaded] = await deps.runner.command(LOADED_VERSION_QUERY);
  if (loaded?.sha256 === deps.sha256) {
    deps.log(`Nutrition dataset ${dataset.version} is already loaded.`);
    return 'up_to_date';
  }

  deps.log(
    `Loading nutrition dataset ${dataset.version}: ${dataset.foods.length} foods, ${dataset.portions.length} portions.`,
  );
  const path = await deps.writeSqlFile(dataStatements(dataset).join('\n'));
  await deps.runner.file(path);
  for (const statement of finishStatements(
    dataset,
    deps.sha256,
    deps.now().toISOString(),
  )) {
    await deps.runner.command(statement);
  }

  await deps.runner.command(INDEX_CHECK_STATEMENT);
  const [counts] = await deps.runner.command(VERIFY_QUERY);
  if (
    counts?.foods !== dataset.foods.length ||
    counts.portions !== dataset.portions.length ||
    counts.version !== dataset.version ||
    counts.sha256 !== deps.sha256
  ) {
    throw new Error(
      `The load did not verify: found ${JSON.stringify(counts)}; expected ${dataset.foods.length} foods, ${dataset.portions.length} portions, version ${dataset.version}.`,
    );
  }
  deps.log(`Loaded and verified nutrition dataset ${dataset.version}.`);
  return 'loaded';
};
