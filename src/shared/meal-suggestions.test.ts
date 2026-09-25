import { describe, expect, it } from 'vitest';

import { addPlanDays } from './meal-plan';
import {
  compareCodePoints,
  MEAL_SUGGESTION_LIMIT,
  MEAL_SUGGESTION_RECENT_DAYS,
  pantryMentions,
  rankMealSuggestions,
  validateSuggestionQuery,
  type MealSuggestionInput,
  type SuggestionPantryItem,
  type SuggestionPlannedDate,
  type SuggestionRecipe,
} from './meal-suggestions';
import type { PantryStatus } from './pantry';

const DATE = '2026-09-24';

const item = (
  name: string,
  status: PantryStatus = 'available',
): SuggestionPantryItem => ({ name, status });

/** The names of the pantry items `lines` mention. */
const mentions = (lines: string[], names: string[]): string[] =>
  pantryMentions(
    lines,
    names.map((name) => item(name)),
  ).map(({ name }) => name);

let nextId = 0;
const recipe = (
  title: string,
  ingredients: string[] = ['water'],
  id = `00000000-0000-4000-8000-${String((nextId += 1)).padStart(12, '0')}`,
): SuggestionRecipe => ({ id, title, ingredients });

const rank = (over: Partial<MealSuggestionInput>, limit?: number) =>
  rankMealSuggestions(
    { date: DATE, pantry: [], recipes: [], planned: [], ...over },
    limit,
  );

const titles = (over: Partial<MealSuggestionInput>, limit?: number) =>
  rank(over, limit).map(({ title }) => title);

const plannedOn = (
  entry: SuggestionRecipe,
  ...offsets: number[]
): SuggestionPlannedDate[] =>
  offsets.map((offset) => ({
    recipeId: entry.id,
    date: addPlanDays(DATE, offset),
  }));

describe('pantry matching', () => {
  it('matches whole words only', () => {
    expect(mentions(['2 eggs, beaten'], ['egg'])).toEqual(['egg']);
    expect(mentions(['1 eggplant'], ['egg'])).toEqual([]);
    expect(mentions(['1 nutmeg'], ['egg'])).toEqual([]);
    expect(mentions(['2 tbsp olive oil'], ['oil'])).toEqual(['oil']);
    expect(mentions(['boiled rice'], ['oil'])).toEqual([]);
  });

  it.each([
    ['egg', '2 eggs'],
    ['tomato', '3 tomatoes'],
    ['eggs', '1 egg'],
    ['beans', 'a bean'],
    ['rice', 'rice'],
  ])('matches %s in “%s”', (name, line) => {
    expect(mentions([line], [name])).toEqual([name]);
  });

  it.each([
    ['egg', 'eggses'],
    ['tomato', 'tomatoess'],
    ['rice', 'ric'],
    ['s', ''],
    ['bean', 'beaness'],
  ])('does not match %s in “%s”', (name, line) => {
    expect(mentions([line], [name])).toEqual([]);
  });

  it('matches a name of several words consecutively, varying only its last', () => {
    expect(mentions(['2 tbsp olive oil'], ['olive oil'])).toEqual([
      'olive oil',
    ]);
    expect(mentions(['4 spring onions'], ['spring onion'])).toEqual([
      'spring onion',
    ]);
    expect(mentions(['oil from olives'], ['olive oil'])).toEqual([]);
    expect(mentions(['olive, then oil'], ['olive oil'])).toEqual([]);
    expect(mentions(['olive, oil'], ['olive oil'])).toEqual(['olive oil']);
    expect(mentions(['olives oil'], ['olive oil'])).toEqual([]);
    expect(mentions(['1 olive'], ['olive oil'])).toEqual([]);
  });

  it('treats punctuation, brackets, and hyphens as separators', () => {
    expect(mentions(['(garlic)'], ['garlic'])).toEqual(['garlic']);
    expect(mentions(['salt-and-pepper'], ['pepper'])).toEqual(['pepper']);
    expect(mentions(['soy/sauce'], ['soy sauce'])).toEqual(['soy sauce']);
    expect(mentions(['1 red pepper'], ['red-pepper'])).toEqual(['red-pepper']);
  });

  it('compares in NFKC form and lower case', () => {
    expect(mentions(['2 EGGS'], ['Egg'])).toEqual(['Egg']);
    // Full-width letters and a composed accent.
    expect(mentions(['ＲＩＣＥ'], ['rice'])).toEqual(['rice']);
    expect(
      mentions(['creme fraiche', 'crème fraîche'], ['Crème Fraîche']),
    ).toEqual(['Crème Fraîche']);
    expect(mentions(['crème'], ['crème'])).toEqual(['crème']);
  });

  it('matches Chinese, Japanese, and Korean names anywhere in a line', () => {
    expect(mentions(['300克豆腐'], ['豆腐'])).toEqual(['豆腐']);
    expect(mentions(['洋蔥 1個'], ['蔥'])).toEqual(['蔥']);
    expect(mentions(['しょうゆ大さじ2'], ['しょうゆ'])).toEqual(['しょうゆ']);
    expect(mentions(['김치 200g'], ['김치'])).toEqual(['김치']);
    // Full-width digits are folded, as for every name.
    expect(mentions(['豆腐２丁'], ['豆腐2丁'])).toEqual(['豆腐2丁']);
    expect(mentions(['2 eggs'], ['豆腐'])).toEqual([]);
    // An ideographic space folds to a space, and runs of spaces to one.
    expect(mentions(['豆腐\u3000 乾 100g'], ['豆腐 乾'])).toEqual(['豆腐 乾']);
  });

  it('keeps pantry order and handles empty input', () => {
    expect(mentions(['rice and eggs'], ['eggs', 'rice'])).toEqual([
      'eggs',
      'rice',
    ]);
    expect(mentions([], ['rice'])).toEqual([]);
    expect(mentions([''], ['rice'])).toEqual([]);
    expect(mentions(['rice'], [])).toEqual([]);
    expect(mentions(['!!!'], ['!!!'])).toEqual([]);
  });

  it('never reads a name as a pattern', () => {
    expect(mentions(['anything at all'], ['.*'])).toEqual([]);
    expect(mentions(['rice (a+)'], ['(a+)+$'])).toEqual(['(a+)+$']);
  });
});

describe('ranking', () => {
  it('suggests nothing from an empty library, and orders by title without data', () => {
    expect(rank({})).toEqual([]);
    const result = rank({
      recipes: [recipe('Pasta'), recipe('curry'), recipe('Bread', [], 'id-b')],
    });
    expect(result.map(({ title }) => title)).toEqual([
      'Bread',
      'curry',
      'Pasta',
    ]);
    expect(result[0]).toEqual({
      recipeId: 'id-b',
      title: 'Bread',
      pantry: { held: [], needed: [] },
      recent: null,
      lastPlanned: null,
    });
  });

  it('puts more held pantry items first; needed items neither count nor subtract', () => {
    const pantry = [
      item('chicken'),
      item('rice', 'low'),
      item('garlic', 'needed'),
      item('soy sauce', 'needed'),
    ];
    const recipes = [
      recipe('A one', ['chicken']),
      recipe('B two needed', ['chicken', 'garlic', 'soy sauce']),
      recipe('C two', ['chicken', '1 cup rice']),
      recipe('D none', ['flour']),
    ];
    const result = rank({ pantry, recipes });
    expect(result.map(({ title }) => title)).toEqual([
      'C two',
      'A one',
      'B two needed',
      'D none',
    ]);
    expect(result[0].pantry).toEqual({
      held: [
        { name: 'chicken', status: 'available' },
        { name: 'rice', status: 'low' },
      ],
      needed: [],
    });
    expect(result[2].pantry).toEqual({
      held: [{ name: 'chicken', status: 'available' }],
      needed: ['garlic', 'soy sauce'],
    });
  });

  it('counts each pantry item once however often a recipe mentions it', () => {
    const recipes = [
      recipe('A', ['rice', 'more rice', 'rices']),
      recipe('B', ['rice', 'egg']),
    ];
    expect(titles({ pantry: [item('rice'), item('egg')], recipes })).toEqual([
      'B',
      'A',
    ]);
  });

  it('lists held and needed items by name, by code point', () => {
    const pantry = [
      item('rice'),
      item('Garlic'),
      item('Egg', 'needed'),
      item('bread', 'needed'),
    ];
    const [only] = rank({
      pantry,
      recipes: [recipe('X', ['garlic', 'rice', 'egg', 'bread'])],
    });
    expect(only.pantry).toEqual({
      held: [
        { name: 'Garlic', status: 'available' },
        { name: 'rice', status: 'available' },
      ],
      needed: ['bread', 'Egg'],
    });
  });

  it('puts recipes planned within 14 days either side after the others', () => {
    const before = recipe('A before');
    const after = recipe('B after');
    const clear = recipe('C clear');
    const result = rank({
      recipes: [before, after, clear],
      planned: [...plannedOn(before, -3), ...plannedOn(after, 5)],
    });
    // Both recent ones follow; B has never been planned before this meal,
    // so the next key puts it ahead of A.
    expect(result.map(({ title }) => title)).toEqual([
      'C clear',
      'B after',
      'A before',
    ]);
    expect(result[1]).toMatchObject({
      recent: addPlanDays(DATE, 5),
      lastPlanned: null,
    });
    expect(result[2]).toMatchObject({
      recent: addPlanDays(DATE, -3),
      lastPlanned: addPlanDays(DATE, -3),
    });
  });

  it.each([
    [-MEAL_SUGGESTION_RECENT_DAYS, true],
    [-(MEAL_SUGGESTION_RECENT_DAYS + 1), false],
    [MEAL_SUGGESTION_RECENT_DAYS, true],
    [MEAL_SUGGESTION_RECENT_DAYS + 1, false],
    [0, true],
  ])('treats a plan %i days away as recent: %s', (offset, recent) => {
    const planned = recipe('Planned');
    const [result] = rank({
      recipes: [planned],
      planned: plannedOn(planned, offset),
    });
    expect(result.recent).toBe(recent ? addPlanDays(DATE, offset) : null);
  });

  it('names the nearest recent date, and the earlier one on a tie', () => {
    const curry = recipe('Curry');
    expect(
      rank({ recipes: [curry], planned: plannedOn(curry, -10, 7, 4, 12) })[0]
        .recent,
    ).toBe(addPlanDays(DATE, 4));
    expect(
      rank({ recipes: [curry], planned: plannedOn(curry, 3, -3) })[0].recent,
    ).toBe(addPlanDays(DATE, -3));
    expect(
      rank({ recipes: [curry], planned: plannedOn(curry, -3, 3) })[0].recent,
    ).toBe(addPlanDays(DATE, -3));
    expect(
      rank({ recipes: [curry], planned: plannedOn(curry, 5, 0, -1) })[0].recent,
    ).toBe(DATE);
  });

  it('keeps the latest date before the meal, whether or not it is recent', () => {
    const curry = recipe('Curry');
    expect(
      rank({ recipes: [curry], planned: plannedOn(curry, -40, -20, 0, 30) })[0],
    ).toMatchObject({ recent: DATE, lastPlanned: addPlanDays(DATE, -20) });
  });

  it('orders by the last planned date: never first, then the oldest', () => {
    const never = recipe('D never');
    const futureOnly = recipe('E future only');
    const old = recipe('A old');
    const older = recipe('B older');
    const oldest = recipe('C oldest');
    expect(
      titles({
        recipes: [old, older, oldest, never, futureOnly],
        planned: [
          ...plannedOn(old, -20),
          ...plannedOn(older, -60),
          ...plannedOn(oldest, -365),
          ...plannedOn(futureOnly, 30),
        ],
      }),
    ).toEqual(['D never', 'E future only', 'C oldest', 'B older', 'A old']);
  });

  it('ranks a recipe not recently planned above a recent one never planned before', () => {
    const recent = recipe('A planned next week');
    const old = recipe('B planned in July');
    expect(
      titles({
        recipes: [recent, old],
        planned: [...plannedOn(recent, 7), ...plannedOn(old, -70)],
      }),
    ).toEqual(['B planned in July', 'A planned next week']);
  });

  it('ranks pantry matches above recency', () => {
    const planned = recipe('A planned yesterday', ['rice', 'egg', 'garlic']);
    const fresh = recipe('B never planned', ['rice', 'egg']);
    expect(
      titles({
        pantry: [item('rice'), item('egg'), item('garlic')],
        recipes: [fresh, planned],
        planned: plannedOn(planned, -1),
      }),
    ).toEqual(['A planned yesterday', 'B never planned']);
  });

  it('breaks ties by normalised title by code point, then by recipe ID', () => {
    const recipes = [
      recipe('b', ['water'], 'id-3'),
      recipe('Ä', ['water'], 'id-4'),
      recipe('B', ['water'], 'id-2'),
      recipe('a', ['water'], 'id-5'),
      recipe('😀', ['water'], 'id-6'),
      recipe('ｚ', ['water'], 'id-7'),
    ];
    expect(rank({ recipes }, 10).map(({ recipeId }) => recipeId)).toEqual([
      'id-5',
      'id-2',
      'id-3',
      'id-7',
      'id-4',
      'id-6',
    ]);
  });

  it('returns at most five', () => {
    const recipes = Array.from({ length: 8 }, (_unused, index) =>
      recipe(`Recipe ${index}`),
    );
    expect(MEAL_SUGGESTION_LIMIT).toBe(5);
    expect(titles({ recipes })).toEqual([
      'Recipe 0',
      'Recipe 1',
      'Recipe 2',
      'Recipe 3',
      'Recipe 4',
    ]);
    expect(titles({ recipes: recipes.slice(0, 2) })).toHaveLength(2);
  });

  it('gives the same order whatever order the input arrives in', () => {
    const recipes = [
      recipe('Soup', ['rice']),
      recipe('Stew', ['rice', 'egg']),
      recipe('Salad', ['egg']),
      recipe('Bake', ['flour']),
    ];
    const pantry = [item('rice'), item('egg', 'low')];
    const planned = plannedOn(recipes[2], -2);
    const forward = rank({ recipes, pantry, planned });
    const backward = rank({
      recipes: recipes.slice().reverse(),
      pantry: pantry.slice().reverse(),
      planned: planned.slice().reverse(),
    });
    expect(backward).toEqual(forward);
  });

  it('ignores plans of unknown recipes and invalid dates', () => {
    const curry = recipe('Curry');
    expect(
      rank({
        recipes: [curry],
        planned: [
          { recipeId: 'other', date: DATE },
          { recipeId: curry.id, date: 'not a date' },
        ],
      })[0],
    ).toMatchObject({ recent: null, lastPlanned: null });
  });

  it('refuses an invalid meal date', () => {
    expect(() => rank({ date: '2026-02-30' })).toThrow(RangeError);
  });
});

describe('code point order', () => {
  it('orders characters outside the Basic Multilingual Plane after it', () => {
    // UTF-16 code units would put U+1F600 (a surrogate pair) before U+FF5A.
    expect(compareCodePoints('😀', 'ｚ')).toBeGreaterThan(0);
    expect(compareCodePoints('a😀', 'aｚ')).toBeGreaterThan(0);
    expect(compareCodePoints('😀', '😁')).toBeLessThan(0);
    expect(compareCodePoints('a', 'ab')).toBeLessThan(0);
    expect(compareCodePoints('b', 'b')).toBe(0);
  });
});

describe('suggestion query', () => {
  const NOW = new Date(`${DATE}T12:00:00.000Z`);
  const query = (value: string) =>
    validateSuggestionQuery(new URLSearchParams(value), NOW);

  it('accepts a date inside the write window, with a day of slack', () => {
    expect(query(`date=${DATE}`)).toEqual({ ok: true, value: { date: DATE } });
    expect(query(`date=${addPlanDays(DATE, -57)}`).ok).toBe(true);
    expect(query(`date=${addPlanDays(DATE, 365)}`).ok).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['a repeated date', `date=${DATE}&date=${DATE}`],
    ['an unknown parameter', `date=${DATE}&slot=dinner`],
    ['only an unknown parameter', 'from=2026-09-24'],
  ])('refuses %s', (_name, value) => {
    expect(query(value)).toEqual({
      ok: false,
      errors: [
        { field: 'request', message: 'Provide date once, and nothing else.' },
      ],
    });
  });

  it.each([
    ['a malformed date', 'date=24-09-2026'],
    ['an impossible date', 'date=2026-02-30'],
    ['an empty date', 'date='],
    ['a date before the window', `date=${addPlanDays(DATE, -58)}`],
    ['a date after the window', `date=${addPlanDays(DATE, 366)}`],
  ])('refuses %s', (_name, value) => {
    const result = query(value);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0].field).toBe('date');
  });
});
