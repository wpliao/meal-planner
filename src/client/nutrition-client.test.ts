import { describe, expect, it } from 'vitest';
import {
  formatNutrient,
  isLineReady,
  parseQuantity,
  reviewGrams,
  reviewLines,
  toMatchInput,
  type ReviewLine,
} from './nutrition-client';
import type { FoodChoice, RecipeNutrition } from '../shared/nutrition';

const soy: FoodChoice = {
  fdcId: 174278,
  name: 'Soy sauce made from soy (tamari)',
  category: 'Legumes and Legume Products',
  dataType: 'sr_legacy',
  portions: [{ seq: 1, amount: 1, label: 'tbsp', gramWeight: 18 }],
  volumeSeq: 1,
};

const line = (over: Partial<ReviewLine> = {}): ReviewLine => ({
  position: 1,
  text: '2 tbsp soy sauce',
  food: soy,
  quantity: '2',
  unit: 'tbsp',
  dontCount: false,
  ...over,
});

describe('formatting', () => {
  it.each([
    ['energyKj', 1234.4, '1,234 kJ (295 kcal)'],
    ['proteinG', 9.94, '9.9 g'],
    ['proteinG', 0.04, '0.0 g'],
    ['fatG', 10.4, '10 g'],
    ['fatG', 123.6, '124 g'],
    ['sodiumMg', 2040.7, '2,041 mg'],
    // USDA's carbohydrate by difference can be slightly negative.
    ['carbohydrateG', -0.37, '0.0 g'],
  ] as const)('shows %s %s as %s', (key, value, text) => {
    expect(formatNutrient(key, value)).toBe(text);
  });
});

describe('amounts', () => {
  it.each([
    ['2', 2],
    [' 1.5 ', 1.5],
    ['1,5', 1.5],
    ['10000', 10_000],
    ['0.125', 0.125],
  ])('reads %j as %s', (typed, value) => {
    expect(parseQuantity(typed)).toBe(value);
  });

  it.each(['', '0', '-1', '1/2', '½', 'two', '1e3', '10001', '1.2345'])(
    'refuses %j',
    (typed) => {
      expect(parseQuantity(typed)).toBeNull();
    },
  );

  it('converts a ready line to grams and a save input', () => {
    expect(reviewGrams(line())).toBe(36.5);
    expect(isLineReady(line())).toBe(true);
    expect(toMatchInput(line())).toEqual({
      position: 1,
      line: '2 tbsp soy sauce',
      fdcId: 174278,
      quantity: 2,
      unit: 'tbsp',
    });
  });

  it('is not ready without a food, an amount, or a usable unit', () => {
    expect(isLineReady(line({ food: null }))).toBe(false);
    expect(isLineReady(line({ quantity: '' }))).toBe(false);
    expect(isLineReady(line({ unit: 'portion:9' }))).toBe(false);
    expect(isLineReady(line({ quantity: '11', unit: 'kg' }))).toBe(false);
  });

  it('sends a line marked "Don\'t count" without a food', () => {
    const skipped = line({ dontCount: true, quantity: '' });
    expect(isLineReady(skipped)).toBe(true);
    expect(toMatchInput(skipped)).toEqual({
      position: 1,
      line: '2 tbsp soy sauce',
      fdcId: null,
    });
  });
});

describe('the review’s lines', () => {
  const nutrition = {
    lines: [
      {
        position: 1,
        text: '2 tbsp soy sauce',
        state: 'counted',
        match: {
          food: soy,
          quantity: 2,
          unit: 'tbsp',
          unitLabel: 'tbsp',
          grams: 36.5,
        },
      },
      { position: 2, text: 'Salt', state: 'not_counted', match: null },
      { position: 3, text: '1 egg', state: 'changed', match: null },
      { position: 4, text: 'Water', state: 'unchecked', match: null },
    ],
  } as RecipeNutrition;

  it('starts every line from its saved match in "all" mode', () => {
    expect(reviewLines(nutrition, 'all')).toEqual([
      line(),
      {
        position: 2,
        text: 'Salt',
        food: null,
        quantity: '',
        unit: 'g',
        dontCount: true,
      },
      {
        position: 3,
        text: '1 egg',
        food: null,
        quantity: '',
        unit: 'g',
        dontCount: false,
      },
      {
        position: 4,
        text: 'Water',
        food: null,
        quantity: '',
        unit: 'g',
        dontCount: false,
      },
    ]);
  });

  it('shows only the changed and unchecked lines in "changed" mode', () => {
    expect(
      reviewLines(nutrition, 'changed').map(({ position }) => position),
    ).toEqual([3, 4]);
  });
});
