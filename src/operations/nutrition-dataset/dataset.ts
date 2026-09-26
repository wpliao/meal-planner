/**
 * The committed nutrition dataset (ADR 0009): a filtered copy of USDA
 * FoodData Central, written by `scripts/nutrition-dataset-build.ts` and loaded
 * into D1 by `scripts/nutrition-dataset-load.ts`. Rows are arrays, one per
 * line in the file, so a review diff shows one food per line.
 */

import type { FoodDataType } from '../../shared/nutrition.ts';

export interface DatasetSource {
  /** "SR Legacy" or "Foundation Foods". */
  name: string;
  release: string;
  url: string;
  sha256: string;
}

/**
 * `[fdcId, name, dataType, category, release, energyKj, proteinG, fatG,
 * saturatedFatG, carbohydrateG, sugarsG, fibreG, sodiumMg, volumeSeq]`, with
 * nutrients per 100 g and `null` where USDA reports no value.
 */
export type DatasetFood = [
  number,
  string,
  FoodDataType,
  string,
  string,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

/** `[fdcId, seq, amount, label, gramWeight]`. */
export type DatasetPortion = [number, number, number, string, number];

export interface NutritionDataset {
  version: string;
  sources: DatasetSource[];
  foods: DatasetFood[];
  portions: DatasetPortion[];
}

/**
 * Writes the dataset as JSON with one food or portion per line, so that a
 * rebuild's diff reads food by food.
 */
export const serializeDataset = (dataset: NutritionDataset): string => {
  const rows = (items: readonly unknown[]): string =>
    items.map((item) => `    ${JSON.stringify(item)}`).join(',\n');
  return [
    '{',
    `  "version": ${JSON.stringify(dataset.version)},`,
    `  "sources": ${JSON.stringify(dataset.sources)},`,
    '  "foods": [',
    rows(dataset.foods),
    '  ],',
    '  "portions": [',
    rows(dataset.portions),
    '  ]',
    '}',
    '',
  ].join('\n');
};

const isNullableNumber = (value: unknown): boolean =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

const isFood = (row: unknown): row is DatasetFood =>
  Array.isArray(row) &&
  row.length === 14 &&
  Number.isInteger(row[0]) &&
  typeof row[1] === 'string' &&
  (row[2] === 'foundation' || row[2] === 'sr_legacy') &&
  typeof row[3] === 'string' &&
  typeof row[4] === 'string' &&
  row.slice(5, 13).every(isNullableNumber) &&
  (row[13] === null || Number.isInteger(row[13]));

const isPortion = (row: unknown): row is DatasetPortion =>
  Array.isArray(row) &&
  row.length === 5 &&
  Number.isInteger(row[0]) &&
  Number.isInteger(row[1]) &&
  typeof row[2] === 'number' &&
  row[2] > 0 &&
  typeof row[3] === 'string' &&
  row[3] !== '' &&
  typeof row[4] === 'number' &&
  row[4] > 0;

/** Parses and checks a dataset file's shape; throws on anything unexpected. */
export const parseDataset = (text: string): NutritionDataset => {
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== 'object') {
    throw new TypeError('The nutrition dataset is not an object.');
  }
  const { version, sources, foods, portions } = value as Record<
    string,
    unknown
  >;
  if (typeof version !== 'string' || version === '') {
    throw new TypeError('The nutrition dataset has no version.');
  }
  if (
    !Array.isArray(sources) ||
    !Array.isArray(foods) ||
    !Array.isArray(portions)
  ) {
    throw new TypeError(
      'The nutrition dataset is missing sources, foods, or portions.',
    );
  }
  const badFood = foods.findIndex((row) => !isFood(row));
  if (badFood !== -1) throw new TypeError(`Food row ${badFood} is malformed.`);
  const badPortion = portions.findIndex((row) => !isPortion(row));
  if (badPortion !== -1) {
    throw new TypeError(`Portion row ${badPortion} is malformed.`);
  }
  return {
    version,
    sources: sources as DatasetSource[],
    foods: foods as DatasetFood[],
    portions: portions as DatasetPortion[],
  };
};
