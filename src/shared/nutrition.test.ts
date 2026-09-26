import { describe, expect, it } from 'vitest';

import {
  buildRecipeNutrition,
  calculateTotals,
  foodSearchQuery,
  gramsPerMillilitre,
  isMatchUnit,
  kilocalories,
  perServing,
  toGrams,
  unitLabel,
  unitsFor,
  usVolumeMillilitres,
  validateSaveNutritionMatches,
  type FoodMeasures,
  type NutrientValues,
  type NutritionFood,
  type StoredMatch,
} from './nutrition';

const values = (overrides: Partial<NutrientValues> = {}): NutrientValues => ({
  energyKj: 100,
  proteinG: 10,
  fatG: 5,
  saturatedFatG: 1,
  carbohydrateG: 20,
  sugarsG: 2,
  fibreG: 3,
  sodiumMg: 400,
  ...overrides,
});

// USDA's soy sauce: 18 g per US tablespoon, 6 g per teaspoon.
const soy: FoodMeasures = {
  portions: [
    { seq: 1, amount: 1, label: 'tbsp', gramWeight: 18 },
    { seq: 2, amount: 1, label: 'tsp', gramWeight: 6 },
  ],
  volumeSeq: 1,
};

// USDA's egg: a large egg is 50 g; its volume portion is a cup of eggs.
const egg: FoodMeasures = {
  portions: [
    { seq: 1, amount: 1, label: 'large', gramWeight: 50 },
    { seq: 2, amount: 2, label: 'medium', gramWeight: 88 },
    { seq: 3, amount: 1, label: 'cup (4.86 large eggs)', gramWeight: 243 },
  ],
  volumeSeq: 3,
};

const noVolume: FoodMeasures = { portions: [], volumeSeq: null };

describe('amounts', () => {
  it.each([
    ['cup, chopped', 236.588],
    ['cups', 236.588],
    ['tbsp', 14.787],
    ['Tablespoon', 14.787],
    ['tsp', 4.929],
    ['teaspoons', 4.929],
    ['fl oz', 29.574],
    ['ml', 1],
    ['milliliter', 1],
    ['quart', 946.353],
  ])('reads %s as a US volume', (label, millilitres) => {
    expect(usVolumeMillilitres(label)).toBe(millilitres);
  });

  it.each(['large', 'slice', 'oz', 'serving', 'cupcake', 'lb'])(
    'reads %s as no volume',
    (label) => {
      expect(usVolumeMillilitres(label)).toBeNull();
    },
  );

  it('converts mass directly and rounds to 0.1 g', () => {
    expect(toGrams(250, 'g', noVolume)).toBe(250);
    expect(toGrams(1.5, 'kg', noVolume)).toBe(1500);
    expect(toGrams(0.123, 'g', noVolume)).toBe(0.1);
  });

  it('converts NZ metric volumes with the food density from USDA', () => {
    // 18 g per 14.787 ml, so 15 ml weighs 18.26 g.
    expect(toGrams(1, 'tbsp', soy)).toBe(18.3);
    expect(toGrams(2, 'tbsp', soy)).toBe(36.5);
    expect(toGrams(1, 'tsp', soy)).toBe(6.1);
    expect(toGrams(1, 'cup', soy)).toBe(304.3);
    expect(toGrams(100, 'ml', soy)).toBe(121.7);
    expect(toGrams(1, 'l', soy)).toBe(1217.3);
    expect(gramsPerMillilitre(egg)).toBeCloseTo(243 / 236.588, 10);
  });

  it('converts a USDA portion by its weight per unit', () => {
    expect(toGrams(3, 'portion:1', egg)).toBe(150);
    // Two medium eggs weigh 88 g, so one is 44 g.
    expect(toGrams(1, 'portion:2', egg)).toBe(44);
  });

  it("can't convert a volume without a density, or a missing portion", () => {
    expect(toGrams(1, 'cup', noVolume)).toBeNull();
    expect(toGrams(1, 'portion:9', egg)).toBeNull();
    expect(
      toGrams(1, 'cup', {
        portions: [{ seq: 1, amount: 1, label: 'large', gramWeight: 50 }],
        volumeSeq: 1,
      }),
    ).toBeNull();
  });

  it('offers mass always, volume with a density, and every portion', () => {
    expect(unitsFor(egg)).toEqual([
      'g',
      'kg',
      'ml',
      'l',
      'tsp',
      'tbsp',
      'cup',
      'portion:1',
      'portion:2',
      'portion:3',
    ]);
    expect(unitsFor(noVolume)).toEqual(['g', 'kg']);
  });

  it('labels portions with their weight each', () => {
    expect(unitLabel('portion:2', egg)).toBe('medium (44 g each)');
    expect(unitLabel('tbsp', egg)).toBe('tbsp');
    expect(unitLabel('portion:7', egg)).toBe('portion:7');
  });

  it.each([
    ['g', true],
    ['cup', true],
    ['portion:1', true],
    ['portion:9999', true],
    ['portion:0', false],
    ['portion:10000', false],
    ['portion:x', false],
    ['cups', false],
    ['', false],
    [1, false],
  ])('recognizes %s as a unit: %s', (unit, expected) => {
    expect(isMatchUnit(unit)).toBe(expected);
  });
});

describe('calculation', () => {
  it('sums each nutrient in proportion to grams', () => {
    const totals = calculateTotals([
      { name: 'A', grams: 50, per100g: values() },
      { name: 'B', grams: 200, per100g: values({ energyKj: 400 }) },
    ]);
    expect(totals?.energyKj).toEqual({ value: 50 + 800, missingFrom: [] });
    expect(totals?.sodiumMg).toEqual({ value: 200 + 800, missingFrom: [] });
  });

  it('adds nothing for a missing value, and names the food once', () => {
    const totals = calculateTotals([
      { name: 'A', grams: 100, per100g: values({ sugarsG: null }) },
      { name: 'A', grams: 100, per100g: values({ sugarsG: null }) },
      { name: 'B', grams: 100, per100g: values() },
    ]);
    expect(totals?.sugarsG).toEqual({ value: 2, missingFrom: ['A'] });
  });

  it('reports no total when no counted food has a value', () => {
    const totals = calculateTotals([
      { name: 'A', grams: 100, per100g: values({ fibreG: null }) },
    ]);
    expect(totals?.fibreG).toEqual({ value: null, missingFrom: ['A'] });
  });

  it('keeps USDA values as they are, including a slightly negative one', () => {
    const totals = calculateTotals([
      { name: 'Chicken', grams: 100, per100g: values({ carbohydrateG: -0.4 }) },
    ]);
    expect(totals?.carbohydrateG.value).toBeCloseTo(-0.4, 10);
  });

  it('has no totals when nothing is counted', () => {
    expect(calculateTotals([])).toBeNull();
  });

  it('divides by servings only when both exist', () => {
    const totals = calculateTotals([
      { name: 'A', grams: 100, per100g: values({ sugarsG: null }) },
    ]);
    expect(perServing(totals, 4)).toMatchObject({
      energyKj: 25,
      sugarsG: null,
    });
    expect(perServing(totals, null)).toBeNull();
    expect(perServing(null, 4)).toBeNull();
  });

  it('gives kcal from kJ', () => {
    expect(kilocalories(4184)).toBe(1000);
  });
});

describe('a recipe’s nutrition', () => {
  const food = (fdcId: number, name: string): NutritionFood => ({
    fdcId,
    name,
    category: 'Tests',
    dataType: 'sr_legacy',
    release: '2018-04',
    per100g: values(),
    ...egg,
  });
  const foods = new Map([
    [1, food(1, 'Egg')],
    [2, food(2, 'Rice')],
  ]);
  const match = (
    position: number,
    lineText: string,
    fdcId: number | null,
  ): StoredMatch => ({
    position,
    lineText,
    fdcId,
    quantity: fdcId === null ? null : 2,
    unit: fdcId === null ? null : 'portion:1',
    grams: fdcId === null ? null : 100,
  });
  const lines = [
    { position: 1, text: '2 eggs' },
    { position: 2, text: '1 cup rice' },
    { position: 3, text: 'Salt' },
    { position: 4, text: 'Water' },
  ];

  it('reads each line’s state from its saved match', () => {
    const nutrition = buildRecipeNutrition({
      recipeVersion: 3,
      servings: 2,
      lines,
      matches: [
        match(1, '2 eggs', 1),
        match(2, '2 cups rice', 2),
        match(3, 'Salt', null),
        match(9, 'Gone', 2),
      ],
      foods,
    });
    expect(nutrition.lines.map(({ state }) => state)).toEqual([
      'counted',
      'changed',
      'not_counted',
      'unchecked',
    ]);
    expect(nutrition.lines[0].match).toEqual({
      food: {
        fdcId: 1,
        name: 'Egg',
        category: 'Tests',
        dataType: 'sr_legacy',
        ...egg,
      },
      quantity: 2,
      unit: 'portion:1',
      unitLabel: 'large (50 g each)',
      grams: 100,
    });
    expect(nutrition).toMatchObject({
      recipeVersion: 3,
      servings: 2,
      checked: true,
      needsCheck: 2,
      counted: 1,
    });
    expect(nutrition.totals?.energyKj.value).toBe(100);
    expect(nutrition.perServing?.energyKj).toBe(50);
    expect(nutrition.sources).toEqual([
      {
        fdcId: 1,
        name: 'Egg',
        dataType: 'sr_legacy',
        release: '2018-04',
        url: 'https://fdc.nal.usda.gov/food-details/1/nutrients',
      },
    ]);
  });

  it('lists a food used twice once among the sources', () => {
    const nutrition = buildRecipeNutrition({
      recipeVersion: 1,
      servings: null,
      lines: lines.slice(0, 2),
      matches: [match(1, '2 eggs', 1), { ...match(2, '1 cup rice', 1) }],
      foods,
    });
    expect(nutrition.sources.map(({ fdcId }) => fdcId)).toEqual([1]);
    expect(nutrition.totals?.energyKj.value).toBe(200);
  });

  it('asks for no check before anything was saved', () => {
    const nutrition = buildRecipeNutrition({
      recipeVersion: 1,
      servings: null,
      lines,
      matches: [],
      foods,
    });
    expect(nutrition).toMatchObject({
      checked: false,
      needsCheck: 0,
      counted: 0,
      totals: null,
      perServing: null,
    });
  });

  it('treats a food missing from the dataset as unchecked', () => {
    const nutrition = buildRecipeNutrition({
      recipeVersion: 1,
      servings: null,
      lines: lines.slice(0, 1),
      matches: [match(1, '2 eggs', 42)],
      foods,
    });
    expect(nutrition.lines[0].state).toBe('unchecked');
    expect(nutrition.needsCheck).toBe(1);
  });
});

describe('saving matches', () => {
  const valid = {
    recipeVersion: 2,
    matches: [
      { position: 1, line: '2 eggs', fdcId: 1, quantity: 2, unit: 'portion:1' },
      { position: 2, line: 'Salt', fdcId: null },
    ],
  };

  it('accepts counted and not-counted matches', () => {
    expect(validateSaveNutritionMatches(valid)).toEqual({
      ok: true,
      value: valid,
    });
  });

  it.each<[string, unknown]>([
    ['not an object', []],
    ['a missing version', { matches: valid.matches }],
    ['an extra field', { ...valid, servings: 2 }],
    ['a zero version', { ...valid, recipeVersion: 0 }],
    ['no matches', { ...valid, matches: [] }],
    [
      '101 matches',
      {
        ...valid,
        matches: Array.from({ length: 101 }, (_, index) => ({
          position: index + 1,
          line: 'x',
          fdcId: null,
        })),
      },
    ],
    [
      'a repeated position',
      { ...valid, matches: [valid.matches[1], valid.matches[1]] },
    ],
    [
      'position 0',
      { ...valid, matches: [{ ...valid.matches[1], position: 0 }] },
    ],
    [
      'position 101',
      { ...valid, matches: [{ ...valid.matches[1], position: 101 }] },
    ],
    [
      'an empty line',
      { ...valid, matches: [{ ...valid.matches[1], line: '' }] },
    ],
    [
      'a 301-character line',
      { ...valid, matches: [{ ...valid.matches[1], line: 'x'.repeat(301) }] },
    ],
    [
      'a string food',
      { ...valid, matches: [{ ...valid.matches[0], fdcId: '1' }] },
    ],
    [
      'a fractional food',
      { ...valid, matches: [{ ...valid.matches[0], fdcId: 1.5 }] },
    ],
    [
      'no amount',
      { ...valid, matches: [{ ...valid.matches[0], quantity: undefined }] },
    ],
    [
      'a negative amount',
      { ...valid, matches: [{ ...valid.matches[0], quantity: -1 }] },
    ],
    [
      'an amount over 10,000',
      { ...valid, matches: [{ ...valid.matches[0], quantity: 10_001 }] },
    ],
    [
      'an infinite amount',
      { ...valid, matches: [{ ...valid.matches[0], quantity: Infinity }] },
    ],
    [
      'an unknown unit',
      { ...valid, matches: [{ ...valid.matches[0], unit: 'pinch' }] },
    ],
    [
      'an amount on a not-counted line',
      { ...valid, matches: [{ ...valid.matches[1], quantity: 1, unit: 'g' }] },
    ],
    [
      'grams from the client',
      { ...valid, matches: [{ ...valid.matches[0], grams: 5 }] },
    ],
    [
      'a nutrient value',
      { ...valid, matches: [{ ...valid.matches[0], energyKj: 5 }] },
    ],
  ])('refuses %s', (_name, input) => {
    expect(validateSaveNutritionMatches(input).ok).toBe(false);
  });
});

describe('food search', () => {
  it.each([
    ['soy sauce', '"soy"* "sauce"*'],
    ['  Heavy CREAM  ', '"heavy"* "cream"*'],
    ['egg" OR "x', '"egg"* "or"* "x"*'],
    ['NEAR(egg, 2)', '"near"* "egg"* "2"*'],
    ['ｅｇｇ', '"egg"*'],
    ['crème fraîche', '"crème"* "fraîche"*'],
    ['a b c d e f g h', '"a"* "b"* "c"* "d"* "e"* "f"*'],
  ])('turns %s into prefix words only', (query, expected) => {
    expect(foodSearchQuery(query)).toBe(expected);
  });

  it.each([null, undefined, 1, 'e', ' e ', '!?', 'x'.repeat(61)])(
    'refuses %s',
    (query) => {
      expect(foodSearchQuery(query)).toBeNull();
    },
  );
});
