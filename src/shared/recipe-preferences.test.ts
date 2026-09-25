import { describe, expect, it } from 'vitest';

import {
  notNowActive,
  notNowEnd,
  RECIPE_NOT_NOW_DAYS,
  validateRecipePreferenceChange,
} from './recipe-preferences';

const NOW = new Date('2026-09-24T12:00:00.000Z');

describe('recipe preferences', () => {
  it('ends Not now exactly seven days of 24 hours later', () => {
    expect(RECIPE_NOT_NOW_DAYS).toBe(7);
    expect(notNowEnd(NOW)).toBe('2026-10-01T12:00:00.000Z');
    // Daylight-saving changes do not matter: the instant is in UTC.
    expect(notNowEnd(new Date('2026-09-26T23:30:00.000Z'))).toBe(
      '2026-10-03T23:30:00.000Z',
    );
  });

  it('applies Not now only while its end is after now', () => {
    expect(notNowActive('2026-10-01T12:00:00.000Z', NOW)).toBe(true);
    expect(notNowActive('2026-09-24T12:00:00.001Z', NOW)).toBe(true);
    expect(notNowActive('2026-09-24T12:00:00.000Z', NOW)).toBe(false);
    expect(notNowActive('2026-09-20T00:00:00.000Z', NOW)).toBe(false);
    expect(notNowActive(null, NOW)).toBe(false);
    expect(notNowActive('not a time', NOW)).toBe(false);
  });

  it.each([
    [{ favourite: true }, { favourite: true }],
    [{ favourite: false }, { favourite: false }],
    [{ notNow: true }, { notNow: true }],
    [{ notNow: false }, { notNow: false }],
  ])('accepts %j', (input, value) => {
    expect(validateRecipePreferenceChange(input)).toEqual({ ok: true, value });
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an array', [true]],
    ['an empty object', {}],
    ['both fields', { favourite: true, notNow: false }],
    ['an unknown field', { star: true }],
    ['a string value', { favourite: 'yes' }],
    ['a number value', { notNow: 0 }],
    ['a null value', { favourite: null }],
    ['an inherited field', Object.create({ favourite: true }) as object],
  ])('refuses %s', (_name, input) => {
    expect(validateRecipePreferenceChange(input)).toEqual({
      ok: false,
      message: 'Send exactly one of favourite or notNow, as true or false.',
    });
  });
});
