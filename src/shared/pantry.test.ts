import { describe, expect, it } from 'vitest';
import {
  cleanPantryDisplayName,
  comparePantryItems,
  isPantryStatus,
  isValidPantryName,
  normalizePantryName,
  PANTRY_NAME_MAX_LENGTH,
  shoppingItems,
  type PantryItem,
  type PantryStatus,
} from './pantry';

const item = (
  id: string,
  name: string,
  status: PantryStatus = 'available',
): PantryItem => ({
  id,
  name,
  status,
  version: 1,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
});

describe('pantry name normalization', () => {
  it.each([
    ['Olive Oil', 'olive oil'],
    ['  olive   oil  ', 'olive oil'],
    ['OLIVE\tOIL', 'olive oil'],
    ['olive\noil', 'olive oil'],
  ])('folds %j to %j', (input, expected) => {
    expect(normalizePantryName(input)).toBe(expected);
  });

  it('preserves the typed capitalisation for display', () => {
    expect(cleanPantryDisplayName('  Crème   Fraîche ')).toBe('Crème Fraîche');
  });

  it('keeps accents and punctuation, which carry meaning in food names', () => {
    expect(normalizePantryName('Jalapeño')).toBe('jalapeño');
    expect(normalizePantryName('half-and-half')).toBe('half-and-half');
    expect(normalizePantryName('jalapeno')).not.toBe(
      normalizePantryName('jalapeño'),
    );
  });

  it('treats canonically equivalent Unicode forms as one item', () => {
    // "é" precomposed versus "e" + combining acute.
    expect(normalizePantryName('café')).toBe(normalizePantryName('café'));
  });

  it('accepts names within bounds and rejects those outside', () => {
    expect(isValidPantryName('')).toBe(false);
    expect(isValidPantryName('a')).toBe(true);
    expect(isValidPantryName('a'.repeat(PANTRY_NAME_MAX_LENGTH))).toBe(true);
    expect(isValidPantryName('a'.repeat(PANTRY_NAME_MAX_LENGTH + 1))).toBe(
      false,
    );
  });

  it('rejects a whitespace-only name once normalized', () => {
    expect(isValidPantryName(normalizePantryName('   \t  '))).toBe(false);
  });
});

describe('pantry status guard', () => {
  it.each(['available', 'low', 'needed'])('accepts %s', (value) => {
    expect(isPantryStatus(value)).toBe(true);
  });

  it.each(['plenty', '', 'AVAILABLE', null, 3, undefined])(
    'rejects %j',
    (value) => {
      expect(isPantryStatus(value)).toBe(false);
    },
  );
});

describe('pantry ordering and shopping filter', () => {
  it('orders needed before low before available', () => {
    const items = [
      item('1', 'rice', 'available'),
      item('2', 'milk', 'low'),
      item('3', 'eggs', 'needed'),
    ];

    expect(
      items
        .slice()
        .sort(comparePantryItems)
        .map((entry) => entry.name),
    ).toEqual(['eggs', 'milk', 'rice']);
  });

  it('sorts alphabetically within one signal, ignoring case', () => {
    const items = [
      item('1', 'Zucchini', 'needed'),
      item('2', 'apples', 'needed'),
      item('3', 'Bread', 'needed'),
    ];

    expect(
      items
        .slice()
        .sort(comparePantryItems)
        .map((entry) => entry.name),
    ).toEqual(['apples', 'Bread', 'Zucchini']);
  });

  it('keeps only low and needed items in the shopping view', () => {
    const items = [
      item('1', 'rice', 'available'),
      item('2', 'milk', 'low'),
      item('3', 'eggs', 'needed'),
    ];

    expect(shoppingItems(items).map((entry) => entry.name)).toEqual([
      'eggs',
      'milk',
    ]);
  });

  it('does not mutate the caller array', () => {
    const items = [item('1', 'milk', 'low'), item('2', 'eggs', 'needed')];
    const before = items.map((entry) => entry.id);

    shoppingItems(items);

    expect(items.map((entry) => entry.id)).toEqual(before);
  });

  it('returns an empty shopping list when everything is available', () => {
    expect(shoppingItems([item('1', 'rice', 'available')])).toEqual([]);
  });
});
