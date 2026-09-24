import { describe, expect, it } from 'vitest';

import {
  addPlanDays,
  isClearableWeek,
  isMealSlot,
  isPlanDate,
  isWithinPlanWindow,
  localPlanDate,
  MEAL_PLAN_HOUSEHOLD_LIMIT,
  MEAL_PLAN_NOTE_MAX_LENGTH,
  MEAL_PLAN_READ_MAX_DAYS,
  MEAL_PLAN_TITLE_MAX_LENGTH,
  MEAL_PLAN_USAGE_HINT_AT,
  MEAL_PLAN_WEEK_ENTRY_MAX,
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  planDateFromDayNumber,
  planDayNumber,
  planDaysBetween,
  planWeekDates,
  planWeekStart,
  planWriteWindow,
  serverPlanWriteWindow,
  utcPlanDate,
  validateClearMealPlanWeek,
  validateCreateMealPlanEntry,
  validateMealPlanNote,
  validateMealPlanRange,
  validateMealPlanRecipeId,
  validateMealPlanTitle,
  validateMealPlanVersion,
  validatePlanDateInWindow,
  validateUpdateMealPlanEntry,
} from './meal-plan';

const RECIPE_ID = '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';
const WINDOW = planWriteWindow('2026-09-24');

describe('plan dates', () => {
  it.each([
    '2026-09-24',
    '2024-02-29',
    '2000-02-29',
    '2026-12-31',
    '0001-01-01',
    '9999-12-31',
  ])('accepts the real date %s', (value) => {
    expect(isPlanDate(value)).toBe(true);
    expect(planDateFromDayNumber(planDayNumber(value) as number)).toBe(value);
  });

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '0000-01-01',
    '2026-9-24',
    '26-09-24',
    '2026-09-24T00:00',
    ' 2026-09-24',
    '2026/09/24',
    '',
  ])('rejects %j', (value) => {
    expect(isPlanDate(value)).toBe(false);
    expect(planDayNumber(value)).toBeNull();
  });

  it('rejects values that are not strings', () => {
    expect(isPlanDate(20260924)).toBe(false);
    expect(isPlanDate(null)).toBe(false);
  });

  it('counts days from 1970-01-01', () => {
    expect(planDayNumber('1970-01-01')).toBe(0);
    expect(planDayNumber('1969-12-31')).toBe(-1);
    expect(planDateFromDayNumber(-1)).toBe('1969-12-31');
  });

  it('adds days across month, year, and leap-day boundaries', () => {
    expect(addPlanDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addPlanDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addPlanDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addPlanDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addPlanDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addPlanDays('2026-09-24', 0)).toBe('2026-09-24');
    expect(planDaysBetween('2026-09-24', '2026-09-30')).toBe(6);
    expect(planDaysBetween('2026-09-30', '2026-09-24')).toBe(-6);
  });

  it('refuses arithmetic on an invalid date', () => {
    expect(() => addPlanDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => planWeekStart('soon')).toThrow(RangeError);
  });

  it.each([
    ['2026-09-21', '2026-09-21'], // a Monday is its own week start
    ['2026-09-24', '2026-09-21'],
    ['2026-09-27', '2026-09-21'], // Sunday ends the week
    ['2026-10-01', '2026-09-28'], // across a month
    ['2027-01-02', '2026-12-28'], // across a year
    ['2024-03-01', '2024-02-26'], // across a leap day
    ['1970-01-01', '1969-12-29'], // before the epoch day count turns positive
  ])('starts the week of %s on Monday %s', (value, monday) => {
    expect(planWeekStart(value)).toBe(monday);
  });

  it.each([
    // US daylight saving began 2026-03-08; the EU's ended 2026-10-25.
    ['2026-03-02', '2026-03-08'],
    ['2026-10-19', '2026-10-25'],
    ['2026-12-28', '2027-01-03'],
  ])(
    'lists seven consecutive dates from %s to %s through clock changes',
    (weekStart, sunday) => {
      const dates = planWeekDates(weekStart);
      expect(dates).toHaveLength(7);
      expect(dates[0]).toBe(weekStart);
      expect(dates[6]).toBe(sunday);
      expect(new Set(dates).size).toBe(7);
    },
  );

  it('reads the local and UTC calendar dates separately', () => {
    // Built from local fields, so the local date holds in any time zone.
    expect(localPlanDate(new Date(2026, 8, 24, 0, 5))).toBe('2026-09-24');
    expect(localPlanDate(new Date(2026, 8, 24, 23, 55))).toBe('2026-09-24');
    expect(utcPlanDate(new Date(Date.UTC(2026, 8, 24, 23, 59)))).toBe(
      '2026-09-24',
    );
    expect(utcPlanDate(new Date(Date.UTC(2026, 8, 25, 0, 0)))).toBe(
      '2026-09-25',
    );
  });
});

describe('write window', () => {
  it('reaches 8 weeks back and 52 weeks ahead of today', () => {
    expect(WINDOW).toEqual({ earliest: '2026-07-30', latest: '2027-09-23' });
    expect(isWithinPlanWindow('2026-07-30', WINDOW)).toBe(true);
    expect(isWithinPlanWindow('2026-07-29', WINDOW)).toBe(false);
    expect(isWithinPlanWindow('2027-09-23', WINDOW)).toBe(true);
    expect(isWithinPlanWindow('2027-09-24', WINDOW)).toBe(false);
  });

  it("widens the Worker's window by a day on each side of the UTC date", () => {
    expect(
      serverPlanWriteWindow(new Date(Date.UTC(2026, 8, 24, 23, 30))),
    ).toEqual({ earliest: '2026-07-29', latest: '2027-09-24' });
  });

  it('explains a date outside the window with its limits', () => {
    expect(validatePlanDateInWindow('2026-09-24', WINDOW)).toEqual({
      ok: true,
      value: '2026-09-24',
    });
    const outside = validatePlanDateInWindow('2036-09-24', WINDOW);
    expect(outside).toEqual({
      ok: false,
      message: expect.stringContaining('2026-07-30 to 2027-09-23') as unknown,
    });
    expect(validatePlanDateInWindow('2026-02-30', WINDOW)).toMatchObject({
      ok: false,
      message: 'Choose a real date in the form YYYY-MM-DD.',
    });
  });
});

describe('fields', () => {
  it('knows the three fixed meals in order', () => {
    expect(MEAL_SLOTS).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(MEAL_SLOTS.map((slot) => MEAL_SLOT_LABELS[slot])).toEqual([
      'Breakfast',
      'Lunch',
      'Dinner',
    ]);
    expect(isMealSlot('lunch')).toBe(true);
    expect(isMealSlot('snack')).toBe(false);
    expect(isMealSlot('Dinner')).toBe(false);
    expect(isMealSlot(1)).toBe(false);
  });

  it('cleans meal text and bounds it in code points', () => {
    expect(validateMealPlanTitle('  Eat \n out ')).toEqual({
      ok: true,
      value: 'Eat out',
    });
    const emoji = '\u{1f355}'.repeat(MEAL_PLAN_TITLE_MAX_LENGTH);
    expect(validateMealPlanTitle(emoji)).toEqual({ ok: true, value: emoji });
    expect(validateMealPlanTitle(`${emoji}x`).ok).toBe(false);
    expect(validateMealPlanTitle(' \t ').ok).toBe(false);
    expect(validateMealPlanTitle(3)).toEqual({
      ok: false,
      message: 'Meal text must be text.',
    });
  });

  it('keeps a note on one line and stores a blank one as none', () => {
    expect(validateMealPlanNote('double\nbatch')).toEqual({
      ok: true,
      value: 'double batch',
    });
    expect(validateMealPlanNote('   ')).toEqual({ ok: true, value: null });
    expect(validateMealPlanNote(null)).toEqual({ ok: true, value: null });
    expect(validateMealPlanNote(undefined)).toEqual({ ok: true, value: null });
    expect(
      validateMealPlanNote('n'.repeat(MEAL_PLAN_NOTE_MAX_LENGTH + 1)).ok,
    ).toBe(false);
    expect(validateMealPlanNote(['x']).ok).toBe(false);
  });

  it('accepts only a recipe UUID, in lower case', () => {
    expect(validateMealPlanRecipeId(RECIPE_ID.toUpperCase())).toEqual({
      ok: true,
      value: RECIPE_ID,
    });
    expect(validateMealPlanRecipeId('recipe-1').ok).toBe(false);
    expect(validateMealPlanRecipeId(7).ok).toBe(false);
  });

  it('accepts only a positive whole version', () => {
    expect(validateMealPlanVersion(3)).toEqual({ ok: true, value: 3 });
    for (const value of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      expect(validateMealPlanVersion(value).ok).toBe(false);
    }
  });
});

describe('create requests', () => {
  it('normalizes a text entry', () => {
    expect(
      validateCreateMealPlanEntry(
        { date: '2026-09-24', slot: 'dinner', title: ' Leftovers ', note: '' },
        WINDOW,
      ),
    ).toEqual({
      ok: true,
      value: {
        date: '2026-09-24',
        slot: 'dinner',
        note: null,
        kind: 'text',
        title: 'Leftovers',
      },
    });
  });

  it('normalizes a recipe entry', () => {
    expect(
      validateCreateMealPlanEntry(
        {
          date: '2026-09-24',
          slot: 'lunch',
          recipeId: RECIPE_ID,
          note: 'double batch',
        },
        WINDOW,
      ),
    ).toEqual({
      ok: true,
      value: {
        date: '2026-09-24',
        slot: 'lunch',
        note: 'double batch',
        kind: 'recipe',
        recipeId: RECIPE_ID,
      },
    });
  });

  it.each([
    ['not an object', 'x', 'Send a plan entry object.'],
    ['an array', [], 'Send a plan entry object.'],
    [
      'an unknown field',
      { date: '2026-09-24', slot: 'dinner', title: 'x', version: 1 },
      'Unexpected fields: version.',
    ],
    [
      'both kinds',
      { date: '2026-09-24', slot: 'dinner', title: 'x', recipeId: RECIPE_ID },
      'Provide exactly one of recipeId or title.',
    ],
    [
      'neither kind',
      { date: '2026-09-24', slot: 'dinner' },
      'Provide exactly one of recipeId or title.',
    ],
  ])('rejects %s as a whole request', (_, input, message) => {
    expect(validateCreateMealPlanEntry(input, WINDOW)).toEqual({
      ok: false,
      errors: [{ field: 'request', message }],
    });
  });

  it('reports every invalid field together', () => {
    const result = validateCreateMealPlanEntry(
      {
        date: '2040-01-01',
        slot: 'snack',
        title: '',
        note: 'n'.repeat(MEAL_PLAN_NOTE_MAX_LENGTH + 1),
      },
      WINDOW,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map(({ field }) => field)).toEqual([
      'date',
      'slot',
      'note',
      'title',
    ]);
  });

  it('reports an invalid recipe ID against its field', () => {
    const result = validateCreateMealPlanEntry(
      { date: '2026-09-24', slot: 'dinner', recipeId: 'nope' },
      WINDOW,
    );
    expect(!result.ok && result.errors).toEqual([
      { field: 'recipeId', message: 'Choose a recipe from the library.' },
    ]);
  });
});

describe('update requests', () => {
  it('accepts version plus any editable field', () => {
    expect(
      validateUpdateMealPlanEntry({
        version: 2,
        date: '2026-09-25',
        slot: 'lunch',
        title: ' Soup ',
        note: null,
      }),
    ).toEqual({
      ok: true,
      value: {
        version: 2,
        date: '2026-09-25',
        slot: 'lunch',
        title: 'Soup',
        note: null,
      },
    });
    // The window is the Worker's to apply once it knows the current date.
    expect(
      validateUpdateMealPlanEntry({ version: 1, date: '1999-01-01' }).ok,
    ).toBe(true);
  });

  it.each([
    ['not an object', null, 'Send a plan entry change object.'],
    ['an unknown field', { version: 1, recipeId: RECIPE_ID }, 'Unexpected'],
    ['no version', { note: 'x' }, 'Provide version and at least one'],
    ['no change', { version: 1 }, 'Provide version and at least one'],
  ])('rejects %s', (_, input, message) => {
    const result = validateUpdateMealPlanEntry(input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0].message).toContain(message);
  });

  it('reports every invalid field', () => {
    const result = validateUpdateMealPlanEntry({
      version: 0,
      date: '2026-02-30',
      slot: 'brunch',
      title: '',
      note: 5,
    });
    expect(!result.ok && result.errors.map(({ field }) => field)).toEqual([
      'version',
      'date',
      'slot',
      'title',
      'note',
    ]);
  });
});

describe('read ranges', () => {
  const range = (query: string) =>
    validateMealPlanRange(new URLSearchParams(query));

  it('accepts one day up to the maximum span', () => {
    expect(range('from=2026-09-24&to=2026-09-24')).toEqual({
      ok: true,
      value: { from: '2026-09-24', to: '2026-09-24' },
    });
    const last = addPlanDays('2026-09-24', MEAL_PLAN_READ_MAX_DAYS - 1);
    expect(range(`from=2026-09-24&to=${last}`).ok).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['only from', 'from=2026-09-24'],
    ['a repeated parameter', 'from=2026-09-24&to=2026-09-24&to=2026-09-25'],
    ['an extra parameter', 'from=2026-09-24&to=2026-09-24&x=1'],
    ['a range that runs backwards', 'from=2026-09-24&to=2026-09-23'],
    ['a range that is too long', 'from=2026-09-24&to=2026-11-05'],
  ])('rejects %s', (_, query) => {
    expect(range(query)).toMatchObject({
      ok: false,
      errors: [{ field: 'request' }],
    });
  });

  it('reports invalid dates against their parameters', () => {
    const result = range('from=2026-02-30&to=someday');
    expect(!result.ok && result.errors.map(({ field }) => field)).toEqual([
      'from',
      'to',
    ]);
  });
});

describe('clearing a week', () => {
  it('holds at most every meal of every day at its limit', () => {
    expect(MEAL_PLAN_WEEK_ENTRY_MAX).toBe(126);
  });

  it('warns from 90% of the household limit', () => {
    expect(MEAL_PLAN_USAGE_HINT_AT).toBe(MEAL_PLAN_HOUSEHOLD_LIMIT * 0.9);
  });

  // Thursday 2026-09-24: the current week starts on Monday 2026-09-21.
  it.each([
    ['last week, on a Thursday', '2026-09-14', '2026-09-24', 0, true],
    ['last week, on the Monday after it', '2026-09-14', '2026-09-21', 0, true],
    ['last week, on its own Sunday', '2026-09-14', '2026-09-20', 0, false],
    ['the current week', '2026-09-21', '2026-09-24', 0, false],
    ['a future week', '2026-09-28', '2026-09-24', 0, false],
    ['a week three years back', '2023-09-18', '2026-09-24', 0, true],
    ['a week across a year end', '2025-12-29', '2026-01-05', 0, true],
    ['a week across a month end', '2026-09-28', '2026-10-05', 0, true],
    ['a date that is not a Monday', '2026-09-15', '2026-09-24', 0, false],
    ['an impossible date', '2026-02-30', '2026-09-24', 0, false],
    ['an invalid today', '2026-09-14', 'today', 0, false],
    ['its Sunday, with a day of slack', '2026-09-14', '2026-09-20', 1, true],
    ['its Saturday, with a day of slack', '2026-09-14', '2026-09-19', 1, false],
  ])(
    '%s: %s on %s (slack %i) is %s',
    (_, weekStart, today, slack, expected) => {
      expect(isClearableWeek(weekStart, today, slack)).toBe(expected);
    },
  );

  const ID = '3f1c2b9e-8d4a-4c3b-9a2e-1f0e5d6c7b8a';
  const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const TODAY = '2026-09-24';

  it('accepts distinct entries and lower-cases their IDs', () => {
    expect(
      validateClearMealPlanWeek(
        '2026-09-14',
        {
          entries: [
            { id: ID.toUpperCase(), version: 3 },
            { id: OTHER, version: 1 },
          ],
        },
        TODAY,
      ),
    ).toEqual({
      ok: true,
      value: {
        weekStart: '2026-09-14',
        entries: [
          { id: ID, version: 3 },
          { id: OTHER, version: 1 },
        ],
      },
    });
  });

  it('accepts a full week of entries', () => {
    const entries = Array.from(
      { length: MEAL_PLAN_WEEK_ENTRY_MAX },
      (_unused, index) => ({
        id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
        version: 1,
      }),
    );
    expect(validateClearMealPlanWeek('2026-09-14', { entries }, TODAY).ok).toBe(
      true,
    );
  });

  it.each([
    ['a week that is not a string', 20260914, { entries: [] }, 'weekStart'],
    ['a day that is not a Monday', '2026-09-15', {}, 'weekStart'],
    ['the current week', '2026-09-21', {}, 'weekStart'],
  ])('rejects %s before reading the body', (_, weekStart, body, field) => {
    const result = validateClearMealPlanWeek(weekStart, body, TODAY);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((error) => error.field)).toEqual([
      field,
    ]);
  });

  it.each([
    ['a body that is not an object', null, 'request'],
    ['a list body', [], 'request'],
    [
      'an unexpected field',
      { entries: [{ id: ID, version: 1 }], x: 1 },
      'request',
    ],
    ['no entries', {}, 'entries'],
    ['an empty list', { entries: [] }, 'entries'],
    [
      'too many entries',
      {
        entries: Array.from({ length: MEAL_PLAN_WEEK_ENTRY_MAX + 1 }, () => ({
          id: ID,
          version: 1,
        })),
      },
      'entries',
    ],
    ['an entry that is not an object', { entries: [ID] }, 'entries'],
    ['a malformed ID', { entries: [{ id: 'abc', version: 1 }] }, 'entries'],
    ['a missing version', { entries: [{ id: ID }] }, 'entries'],
    [
      'a fractional version',
      { entries: [{ id: ID, version: 1.5 }] },
      'entries',
    ],
    [
      'an extra field',
      { entries: [{ id: ID, version: 1, date: TODAY }] },
      'entries',
    ],
    [
      'the same entry twice',
      {
        entries: [
          { id: ID, version: 1 },
          { id: ID.toUpperCase(), version: 2 },
        ],
      },
      'entries',
    ],
  ])('rejects %s', (_, body, field) => {
    const result = validateClearMealPlanWeek('2026-09-14', body, TODAY);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((error) => error.field)).toEqual([
      field,
    ]);
  });
});
