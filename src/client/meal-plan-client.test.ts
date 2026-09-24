import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import {
  checkDate,
  checkMoveDate,
  checkNote,
  checkTitle,
  clientWriteWindow,
  dayLabel,
  describeEntry,
  entryConflictFrom,
  filterRecipes,
  groupWeek,
  hasErrors,
  isEntryGone,
  placeLabel,
  planFailure,
  resolveWeek,
  today,
  weekdayName,
  weekHeading,
  weekPath,
  weekQuery,
  weekRange,
} from './meal-plan-client';
import { recipeEntry, textEntry } from '../../test/client/meal-plan';

describe('weeks and dates', () => {
  it('reads today from the device clock in local time', () => {
    expect(today(new Date(2026, 8, 24, 23, 59))).toBe('2026-09-24');
    expect(today(new Date(2026, 8, 25, 0, 1))).toBe('2026-09-25');
    expect(clientWriteWindow(new Date(2026, 8, 24, 12))).toEqual({
      earliest: '2026-07-30',
      latest: '2027-09-23',
    });
  });

  it.each([
    [undefined, { weekStart: '2026-09-21', replace: false }],
    ['2026-09-21', { weekStart: '2026-09-21', replace: false }],
    ['2026-09-27', { weekStart: '2026-09-21', replace: true }],
    ['2026-02-30', { weekStart: '2026-09-21', replace: true }],
    ['next-week', { weekStart: '2026-09-21', replace: true }],
    ['2027-01-01', { weekStart: '2026-12-28', replace: true }],
  ])('resolves the URL week %s', (param, expected) => {
    expect(resolveWeek(param, '2026-09-24')).toEqual(expected);
  });

  it('names days and places in words', () => {
    expect(weekdayName('2026-09-21')).toBe('Monday');
    expect(weekdayName('2026-09-27')).toBe('Sunday');
    expect(weekdayName('1970-01-01')).toBe('Thursday');
    expect(dayLabel('2026-09-24')).toBe('Thursday 24 September');
    expect(placeLabel('2026-10-01', 'lunch')).toBe(
      'lunch on Thursday 1 October',
    );
  });

  it.each([
    ['2026-09-21', '21–27 September 2026'],
    ['2026-09-28', '28 September – 4 October 2026'],
    ['2025-12-29', '29 December 2025 – 4 January 2026'],
  ])('heads the week of %s as %s', (weekStart, heading) => {
    expect(weekHeading(weekStart)).toBe(heading);
  });

  it('builds week URLs and the read range', () => {
    expect(weekPath('2026-09-21')).toBe('/plan/2026-09-21');
    expect(weekRange('2026-09-28')).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
    });
    expect(weekQuery('2026-09-21')).toBe(
      '/api/meal-plan?from=2026-09-21&to=2026-09-27',
    );
  });

  it('files entries by date and meal and ignores dates outside the week', () => {
    const lunch = textEntry({ id: 'l', slot: 'lunch' });
    const dinner = recipeEntry({ id: 'd' });
    const stray = textEntry({ id: 's', date: '2026-10-05' });
    const grouped = groupWeek('2026-09-21', [lunch, dinner, stray]);

    expect(Object.keys(grouped)).toHaveLength(7);
    expect(grouped['2026-09-24']).toEqual({
      breakfast: [],
      lunch: [lunch],
      dinner: [dinner],
    });
    expect(grouped['2026-10-05']).toBeUndefined();
  });
});

describe('responses', () => {
  const current = textEntry({ version: 3 });

  it('recognizes a stale-version conflict and its current entry', () => {
    const stale = new ApiRequestError('stale', 409, {
      error: { code: 'stale_version', message: 'stale' },
      current,
    });
    expect(entryConflictFrom(stale)).toEqual(current);
    // A full meal is also a 409, but not a conflict to compare.
    expect(
      entryConflictFrom(
        new ApiRequestError('full', 409, {
          error: { code: 'limit_reached', message: 'full' },
        }),
      ),
    ).toBeNull();
    expect(entryConflictFrom(new ApiRequestError('x', 400, {}))).toBeNull();
    expect(entryConflictFrom(new Error('offline'))).toBeNull();
  });

  it('recognizes a gone entry and picks a message', () => {
    expect(isEntryGone(new ApiRequestError('gone', 404, {}))).toBe(true);
    expect(isEntryGone(new ApiRequestError('bad', 400, {}))).toBe(false);
    expect(isEntryGone(new Error('offline'))).toBe(false);
    expect(planFailure(new ApiRequestError('Server says', 409, {}), 'x')).toBe(
      'Server says',
    );
    expect(planFailure(new TypeError('Failed to fetch'), 'Fallback')).toBe(
      'Fallback',
    );
  });

  it('describes an entry with or without its note', () => {
    expect(describeEntry(textEntry())).toBe('“Leftovers”');
    expect(describeEntry(textEntry({ note: 'reheat' }))).toBe(
      '“Leftovers” (reheat)',
    );
  });
});

describe('form checks', () => {
  const window = { earliest: '2026-07-30', latest: '2027-09-23' };

  it('checks dates against the window, but not an unchanged one', () => {
    expect(checkDate('', window)).toBe('Choose a date.');
    expect(checkDate('2026-09-24', window)).toBeUndefined();
    expect(checkDate('2028-01-01', window)).toContain('52 weeks ahead');
    expect(checkMoveDate('2026-01-01', '2026-01-01', window)).toBeUndefined();
    expect(checkMoveDate('2026-01-02', '2026-01-01', window)).toContain(
      '2026-07-30',
    );
  });

  it('checks meal text and notes with the shared rules', () => {
    expect(checkTitle('  ')).toContain('between 1 and 120');
    expect(checkTitle('Leftovers')).toBeUndefined();
    expect(checkNote(' ')).toEqual({ ok: true, value: null });
    expect(checkNote('n'.repeat(201)).ok).toBe(false);
    expect(hasErrors({})).toBe(false);
    expect(hasErrors({ title: undefined, note: 'Too long' })).toBe(true);
  });

  it('filters recipes by every typed word, ignoring case', () => {
    const recipes = [
      { title: 'Soy chicken' },
      { title: 'Chicken soup' },
      { title: 'Miso soup' },
    ];
    expect(filterRecipes(recipes, '')).toEqual(recipes);
    expect(filterRecipes(recipes, 'SOUP')).toEqual(recipes.slice(1));
    expect(filterRecipes(recipes, 'chicken soup')).toEqual([recipes[1]]);
    expect(filterRecipes(recipes, 'pizza')).toEqual([]);
  });
});
