import { describe, expect, it } from 'vitest';
import { ApiRequestError } from './api';
import {
  changedFields,
  conflictFrom,
  failureMessage,
  importHost,
  isNotFound,
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
  source: { kind: 'manual' },
  version: 2,
  createdAt: '2026-09-21T00:00:00.000Z',
  updatedAt: '2026-09-21T00:00:00.000Z',
};

describe('recipe client helpers', () => {
  it('labels manual and website sources', () => {
    expect(sourceLabel({ kind: 'manual' })).toBe('Manual');
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
    };
    expect(changedFields(same, saved)).toEqual([]);
    expect(
      changedFields(
        {
          title: 'Rice!',
          notes: 'n',
          ingredients: ['rice', 'salt'],
          steps: ['boil'],
        },
        saved,
      ),
    ).toEqual(['title', 'ingredients', 'steps', 'notes']);
  });

  it('validates and normalizes a complete form with the shared rules', () => {
    expect(
      validateRecipeForm({
        title: '  Rice  ',
        ingredients: ['', ' rice '],
        steps: ['cook', ''],
        notes: '   ',
      }),
    ).toEqual({
      ok: true,
      content: {
        title: 'Rice',
        notes: null,
        ingredients: ['rice'],
        steps: ['cook'],
      },
    });
  });

  it('reports a too-long ingredient on the visible line', () => {
    const result = validateRecipeForm({
      title: 'Rice',
      ingredients: ['', 'x'.repeat(301)],
      steps: ['cook'],
      notes: '',
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
