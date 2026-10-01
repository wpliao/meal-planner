import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import {
  changedFields,
  conflictFrom,
  failureMessage,
  importHost,
  isNotFound,
  safeRecipeLink,
  safeSourceHref,
  sourceLabel,
  validateRecipeForm,
} from './recipe-client';
import type { Recipe } from '../shared/recipes';

const saved: Recipe = {
  id: 'r',
  title: 'Rice',
  notes: null,
  ingredients: ['rice'],
  steps: ['cook'],
  servings: null,
  link: null,
  source: { kind: 'manual' },
  version: 2,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
};

describe('recipe client helpers', () => {
  it('labels manual and website sources', () => {
    expect(sourceLabel({ kind: 'manual', linkHost: null })).toBe('Manual');
    expect(
      sourceLabel({ kind: 'manual', linkHost: 'www.kikkoman.com.sg' }),
    ).toBe('Manual · www.kikkoman.com.sg');
    expect(sourceLabel({ kind: 'website', host: 'budgetbytes.com' })).toBe(
      'budgetbytes.com',
    );
  });

  it('links only to https sources, preferring the page the text came from', () => {
    expect(safeSourceHref({ kind: 'manual' })).toBeNull();
    expect(
      safeSourceHref({
        kind: 'website',
        submittedUrl: 'https://budgetbytes.com/a',
      }),
    ).toBe('https://budgetbytes.com/a');
    expect(
      safeSourceHref({
        kind: 'website',
        submittedUrl: 'https://budgetbytes.com/a',
        resolvedUrl: 'https://www.budgetbytes.com/b',
      }),
    ).toBe('https://www.budgetbytes.com/b');
    expect(
      safeSourceHref({
        kind: 'website',
        submittedUrl: 'http://budgetbytes.com',
      }),
    ).toBeNull();
    expect(
      safeSourceHref({ kind: 'website', submittedUrl: 'data:text/html,x' }),
    ).toBeNull();
    expect(importHost({ kind: 'website', submittedUrl: '::' })).toBeNull();
  });

  it('recognizes a stale-version conflict only when it carries the recipe', () => {
    const body = {
      error: { code: 'stale_version', message: 'm' },
      current: saved,
    };
    expect(conflictFrom(new ApiRequestError('m', 409, body))).toEqual(saved);
    expect(
      conflictFrom(
        new ApiRequestError('m', 409, {
          error: { code: 'state_conflict', message: 'm' },
        }),
      ),
    ).toBeNull();
    expect(conflictFrom(new ApiRequestError('m', 409, undefined))).toBeNull();
    expect(conflictFrom(new ApiRequestError('m', 400, body))).toBeNull();
    expect(conflictFrom(new Error('network'))).toBeNull();
  });

  it('uses the server message when there is one', () => {
    expect(
      failureMessage(new ApiRequestError('Server says', 400, {}), 'f'),
    ).toBe('Server says');
    expect(failureMessage(new TypeError('Failed to fetch'), 'fallback')).toBe(
      'fallback',
    );
    expect(isNotFound(new ApiRequestError('m', 404, {}))).toBe(true);
    expect(isNotFound(new Error('m'))).toBe(false);
  });

  it('names the parts of a draft that differ from the saved recipe', () => {
    const same = {
      title: 'Rice',
      notes: null,
      ingredients: ['rice'],
      steps: ['cook'],
      servings: null,
      link: null,
    };
    expect(changedFields(same, saved)).toEqual([]);
    expect(
      changedFields(
        {
          title: 'Rice!',
          notes: 'n',
          ingredients: ['rice', 'salt'],
          steps: ['boil'],
          servings: 4,
          link: 'https://example.com/rice',
        },
        saved,
      ),
    ).toEqual([
      'title',
      'ingredients',
      'steps',
      'notes',
      'servings',
      'recipe link',
    ]);
  });

  it('validates and normalizes a complete form with the shared rules', () => {
    expect(
      validateRecipeForm({
        title: '  Rice  ',
        ingredients: ['', ' rice '],
        steps: ['cook', ''],
        notes: '   ',
        servings: ' 4 ',
        link: '',
      }),
    ).toEqual({
      ok: true,
      content: {
        title: 'Rice',
        notes: null,
        ingredients: ['rice'],
        steps: ['cook'],
        servings: 4,
        link: null,
      },
    });
  });

  it.each([
    ['', null],
    ['1', 1],
    ['50', 50],
  ])('reads servings %j as %s', (typed, servings) => {
    const result = validateRecipeForm({
      title: 'Rice',
      ingredients: ['rice'],
      steps: ['cook'],
      notes: '',
      servings: typed,
      link: '',
    });
    expect(result.ok && result.content.servings).toBe(servings);
  });

  it.each(['0', '51', '2.5', 'four', '-1', '1e1'])(
    'refuses servings of %j with the shared message',
    (typed) => {
      const result = validateRecipeForm({
        title: 'Rice',
        ingredients: ['rice'],
        steps: ['cook'],
        notes: '',
        servings: typed,
        link: '',
      });
      expect(!result.ok && result.errors.servings).toBe(
        'Servings must be a whole number from 1 to 50.',
      );
    },
  );

  it.each([
    ['', null],
    ['   ', null],
    [
      ' https://www.kikkoman.com.sg/product_recipes/soy-chicken/#steps ',
      'https://www.kikkoman.com.sg/product_recipes/soy-chicken/',
    ],
  ])('reads the recipe link %j as %j', (typed, link) => {
    const result = validateRecipeForm({
      title: 'Rice',
      ingredients: ['rice'],
      steps: ['cook'],
      notes: '',
      servings: '',
      link: typed,
    });
    expect(result.ok && result.content.link).toBe(link);
  });

  it.each([
    [
      'www.kikkoman.com.sg/recipe',
      'The recipe link is not a web address. Paste the whole link, starting with https://.',
    ],
    [
      'http://example.com/rice',
      'The recipe link must be an https web address without a username, password, or port.',
    ],
  ])('refuses the recipe link %j beside the field', (typed, message) => {
    const result = validateRecipeForm({
      title: 'Rice',
      ingredients: ['rice'],
      steps: ['cook'],
      notes: '',
      servings: '',
      link: typed,
    });
    expect(!result.ok && result.errors.link).toBe(message);
  });

  it('links a manual recipe only to an https link, with its host', () => {
    expect(safeRecipeLink(null)).toBeNull();
    expect(safeRecipeLink('javascript:alert(1)')).toBeNull();
    expect(safeRecipeLink('not a url')).toBeNull();
    expect(safeRecipeLink('https://www.kikkoman.com.sg/a/')).toEqual({
      href: 'https://www.kikkoman.com.sg/a/',
      host: 'www.kikkoman.com.sg',
    });
  });

  it('reports a too-long ingredient on the visible line', () => {
    const result = validateRecipeForm({
      title: 'Rice',
      ingredients: ['', 'x'.repeat(301)],
      steps: ['cook'],
      notes: '',
      servings: '',
      link: '',
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        ingredientLines: {
          1: 'Ingredient 2 is longer than 300 characters (it has 301).',
        },
        stepLines: {},
      },
    });
  });
});
