/**
 * Builds the nutrition dataset from USDA FoodData Central CSV releases
 * (ADR 0009; decisions 1 and 2 of the #84 design). Pure: the caller supplies
 * each release's files as text.
 */

import {
  KJ_PER_KCAL,
  usVolumeMillilitres,
  type FoodDataType,
} from '../../shared/nutrition.ts';
import { csvRecords, parseCsv } from './csv.ts';
import type {
  DatasetFood,
  DatasetPortion,
  DatasetSource,
  NutritionDataset,
} from './dataset.ts';

/** Bumped when the build's rules change for the same USDA releases. */
export const BUILD_REVISION = 1;

/** USDA categories a home recipe doesn't use (decision 2). */
export const EXCLUDED_CATEGORIES: readonly string[] = [
  'Baby Foods',
  'Fast Foods',
  'Restaurant Foods',
  'Meals, Entrees, and Side Dishes',
];

interface NutrientSpec {
  number: string;
  unit: string;
  name: RegExp;
}

/** The USDA nutrients read, by nutrient number, with the unit and name each must have. */
const NUTRIENT_SPECS: Record<string, NutrientSpec> = {
  energyKj: { number: '268', unit: 'KJ', name: /^Energy$/u },
  energyKcal: { number: '208', unit: 'KCAL', name: /^Energy$/u },
  atwaterSpecific: {
    number: '958',
    unit: 'KCAL',
    name: /^Energy \(Atwater Specific Factors\)$/u,
  },
  atwaterGeneral: {
    number: '957',
    unit: 'KCAL',
    name: /^Energy \(Atwater General Factors\)$/u,
  },
  protein: { number: '203', unit: 'G', name: /^Protein$/u },
  fat: { number: '204', unit: 'G', name: /^Total lipid \(fat\)$/u },
  saturatedFat: {
    number: '606',
    unit: 'G',
    name: /^Fatty acids, total saturated$/u,
  },
  carbohydrate: {
    number: '205',
    unit: 'G',
    name: /^Carbohydrate, by difference$/u,
  },
  sugars: {
    number: '269',
    unit: 'G',
    name: /^(?:Sugars, Total|Total Sugars)$/u,
  },
  sugarsNlea: {
    number: '269.3',
    unit: 'G',
    name: /^Sugars, Total(?: NLEA)?$/u,
  },
  fibre: { number: '291', unit: 'G', name: /^Fiber, total dietary$/u },
  sodium: { number: '307', unit: 'MG', name: /^Sodium, Na$/u },
};

type NutrientName = keyof typeof NUTRIENT_SPECS;

export interface ReleaseInput {
  source: DatasetSource;
  /** The USDA `data_type` of the foods to take from this release. */
  usdaDataType: 'sr_legacy_food' | 'foundation_food';
  dataType: FoodDataType;
  /** Reads one CSV file of the release, such as `food.csv`, as text. */
  read: (file: string) => string;
}

/**
 * Maps each nutrient this build reads to the release's nutrient ID, and
 * fails when a number is missing or its unit or name has changed.
 */
const nutrientIds = (nutrientCsv: string): Map<string, NutrientName> => {
  const byNumber = new Map(
    parseCsv(nutrientCsv).map((row) => [row.nutrient_nbr, row]),
  );
  const ids = new Map<string, NutrientName>();
  for (const [key, spec] of Object.entries(NUTRIENT_SPECS)) {
    const row = byNumber.get(spec.number);
    if (!row) throw new Error(`USDA nutrient ${spec.number} is missing.`);
    if (
      row.unit_name.toUpperCase() !== spec.unit ||
      !spec.name.test(row.name)
    ) {
      throw new Error(
        `USDA nutrient ${spec.number} is "${row.name}" in ${row.unit_name}; expected ${spec.name.source} in ${spec.unit}.`,
      );
    }
    ids.set(row.id, key);
  }
  return ids;
};

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

/**
 * Energy in kJ: reported kJ; else kcal × 4.184; else the Atwater specific,
 * then general, factors in kcal × 4.184.
 */
const energyKj = (values: Map<NutrientName, number>): number | null => {
  const kj = values.get('energyKj');
  if (kj !== undefined) return kj;
  for (const key of [
    'energyKcal',
    'atwaterSpecific',
    'atwaterGeneral',
  ] as const) {
    const kcal = values.get(key);
    if (kcal !== undefined) return roundTenth(kcal * KJ_PER_KCAL);
  }
  return null;
};

const valueOrNull = (
  values: Map<NutrientName, number>,
  ...keys: NutrientName[]
): number | null => {
  for (const key of keys) {
    const value = values.get(key);
    if (value !== undefined) return value;
  }
  return null;
};

/** A portion's label: the unit (unless undetermined), modifier, and description. */
const portionLabel = (
  row: Record<string, string>,
  units: Map<string, string>,
): string => {
  const unit = units.get(row.measure_unit_id) ?? '';
  return [
    unit === 'undetermined' ? '' : unit,
    row.modifier,
    row.portion_description,
  ]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(', ');
};

interface PortionRow {
  order: number;
  seq: number | null;
  amount: number;
  label: string;
  gramWeight: number;
}

const readPortions = (
  release: ReleaseInput,
  included: Set<string>,
): Map<string, PortionRow[]> => {
  const units = new Map(
    parseCsv(release.read('measure_unit.csv')).map((row) => [row.id, row.name]),
  );
  const byFood = new Map<string, PortionRow[]>();
  for (const row of csvRecords(release.read('food_portion.csv'))) {
    if (!included.has(row.fdc_id)) continue;
    const amount = Number(row.amount);
    const gramWeight = Number(row.gram_weight);
    const label = portionLabel(row, units);
    const positive = (value: number) => Number.isFinite(value) && value > 0;
    if (!positive(amount) || !positive(gramWeight) || label === '') continue;
    const list = byFood.get(row.fdc_id) ?? [];
    list.push({
      order: Number(row.id),
      seq: row.seq_num === '' ? null : Number(row.seq_num),
      amount,
      label,
      gramWeight,
    });
    byFood.set(row.fdc_id, list);
  }
  return byFood;
};

/** Numbers portions 1… in USDA's order: its sequence number, then row ID. */
const numberPortions = (rows: PortionRow[]): PortionRow[] =>
  [...rows].sort(
    (a, b) =>
      (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) ||
      a.order - b.order,
  );

/** Volume labels with nothing else, such as "tbsp" or "fl oz". */
const PLAIN_VOLUMES: ReadonlySet<string> = new Set([
  'cup',
  'cups',
  'tbsp',
  'tablespoon',
  'tablespoons',
  'tsp',
  'teaspoon',
  'teaspoons',
  'fl oz',
  'fl. oz',
  'floz',
  'ml',
  'milliliter',
  'milliliters',
  'millilitre',
  'millilitres',
]);

/**
 * The portion that gives a food its density: the first plain volume measure
 * ("tbsp", not "cup, whipped", which describes a changed food), else the
 * first volume portion of any kind, else none. Numbered from 1.
 */
const volumeSeq = (rows: readonly PortionRow[]): number | null => {
  const labels = rows.map((row) => row.label.trim().toLowerCase());
  const plain = labels.findIndex((label) => PLAIN_VOLUMES.has(label));
  if (plain !== -1) return plain + 1;
  const any = labels.findIndex((label) => usVolumeMillilitres(label) !== null);
  return any === -1 ? null : any + 1;
};

const readValues = (
  release: ReleaseInput,
  candidates: Set<string>,
): Map<string, Map<NutrientName, number>> => {
  const ids = nutrientIds(release.read('nutrient.csv'));
  const values = new Map<string, Map<NutrientName, number>>();
  for (const row of csvRecords(release.read('food_nutrient.csv'))) {
    const key = ids.get(row.nutrient_id);
    if (key === undefined || !candidates.has(row.fdc_id) || row.amount === '') {
      continue;
    }
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    const food = values.get(row.fdc_id) ?? new Map<NutrientName, number>();
    food.set(key, amount);
    values.set(row.fdc_id, food);
  }
  return values;
};

interface ReleaseFoods {
  foods: DatasetFood[];
  portions: DatasetPortion[];
}

const buildRelease = (release: ReleaseInput): ReleaseFoods => {
  const categories = new Map(
    parseCsv(release.read('food_category.csv')).map((row) => [
      row.id,
      row.description,
    ]),
  );
  const candidates = new Map<string, { name: string; category: string }>();
  for (const row of csvRecords(release.read('food.csv'))) {
    if (row.data_type !== release.usdaDataType) continue;
    const category = categories.get(row.food_category_id) ?? '';
    if (EXCLUDED_CATEGORIES.includes(category)) continue;
    candidates.set(row.fdc_id, { name: row.description.trim(), category });
  }

  const values = readValues(release, new Set(candidates.keys()));
  const foods: DatasetFood[] = [];
  const included = new Set<string>();
  for (const [fdcId, food] of candidates) {
    const nutrients = values.get(fdcId) ?? new Map<NutrientName, number>();
    const energy = energyKj(nutrients);
    // A food with no energy value at all isn't offered.
    if (energy === null) continue;
    included.add(fdcId);
    foods.push([
      Number(fdcId),
      food.name,
      release.dataType,
      food.category,
      release.source.release,
      energy,
      valueOrNull(nutrients, 'protein'),
      valueOrNull(nutrients, 'fat'),
      valueOrNull(nutrients, 'saturatedFat'),
      valueOrNull(nutrients, 'carbohydrate'),
      valueOrNull(nutrients, 'sugars', 'sugarsNlea'),
      valueOrNull(nutrients, 'fibre'),
      valueOrNull(nutrients, 'sodium'),
      null,
    ]);
  }

  const portionRows = readPortions(release, included);
  const portions: DatasetPortion[] = [];
  for (const food of foods) {
    const rows = numberPortions(portionRows.get(String(food[0])) ?? []);
    rows.forEach((row, index) => {
      portions.push([
        food[0],
        index + 1,
        row.amount,
        row.label,
        row.gramWeight,
      ]);
    });
    food[13] = volumeSeq(rows);
  }
  return { foods, portions };
};

/**
 * Builds the dataset from the releases, in FDC ID order. A food's
 * nutrients, name, and portions are USDA's; the only derived values are
 * energy converted to kJ and each food's volume portion.
 */
export const buildDataset = (
  releases: readonly ReleaseInput[],
): NutritionDataset => {
  const foods: DatasetFood[] = [];
  const portions: DatasetPortion[] = [];
  for (const release of releases) {
    const built = buildRelease(release);
    foods.push(...built.foods);
    portions.push(...built.portions);
  }
  foods.sort((a, b) => a[0] - b[0]);
  portions.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const version = [
    'usda-fdc',
    ...releases.map((release) => release.source.release),
    `r${BUILD_REVISION}`,
  ].join('_');
  return {
    version,
    sources: releases.map((release) => release.source),
    foods,
    portions,
  };
};
