/**
 * Rebuilds `data/nutrition/usda-fdc.json` from the pinned USDA FoodData
 * Central releases (ADR 0009). Run it in the Dev Container, review the diff,
 * and commit the file; Deploy loads it with `scripts/nutrition-dataset-load.ts`.
 *
 *   node scripts/nutrition-dataset-build.ts [--cache <dir>]
 *
 * Each release is downloaded (or read from the cache directory) and must
 * match its pinned SHA-256. Node 24 runs this file with type stripping.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  buildDataset,
  type ReleaseInput,
} from '../src/operations/nutrition-dataset/build.ts';
import { serializeDataset } from '../src/operations/nutrition-dataset/dataset.ts';

const RELEASES = [
  {
    name: 'SR Legacy',
    release: '2018-04',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip',
    sha256: 'b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0',
    usdaDataType: 'sr_legacy_food',
    dataType: 'sr_legacy',
  },
  {
    name: 'Foundation Foods',
    release: '2026-04-30',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip',
    sha256: '70457ee9d9342f43bda2010318c85f04210c689fdeb9cd2da4c513b0e8dbc655',
    usdaDataType: 'foundation_food',
    dataType: 'foundation',
  },
] as const;

const OUTPUT = new URL('../data/nutrition/usda-fdc.json', import.meta.url);

const { values } = parseArgs({
  options: { cache: { type: 'string' } },
});
const cache = values.cache ?? join(tmpdir(), 'meal-planner-usda');
mkdirSync(cache, { recursive: true });

const sha256 = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');

const fetchRelease = async (url: string, expected: string): Promise<string> => {
  const path = join(cache, basename(new URL(url).pathname));
  if (!existsSync(path)) {
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  const actual = sha256(readFileSync(path));
  if (actual !== expected) {
    throw new Error(`${path} has SHA-256 ${actual}; expected ${expected}.`);
  }
  return path;
};

/** Reads one CSV from the zip; each release keeps its files in one folder. */
const reader = (zip: string) => {
  const folder = basename(zip, '.zip');
  return (file: string): string => {
    const result = spawnSync('unzip', ['-p', zip, `${folder}/${file}`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`Could not read ${file} from ${zip}: ${result.stderr}`);
    }
    return result.stdout;
  };
};

const releases: ReleaseInput[] = [];
for (const release of RELEASES) {
  const zip = await fetchRelease(release.url, release.sha256);
  releases.push({
    source: {
      name: release.name,
      release: release.release,
      url: release.url,
      sha256: release.sha256,
    },
    usdaDataType: release.usdaDataType,
    dataType: release.dataType,
    read: reader(zip),
  });
}

const dataset = buildDataset(releases);
mkdirSync(new URL('./', OUTPUT), { recursive: true });
writeFileSync(OUTPUT, serializeDataset(dataset));
console.log(
  `Wrote ${dataset.version}: ${dataset.foods.length} foods, ${dataset.portions.length} portions.`,
);
