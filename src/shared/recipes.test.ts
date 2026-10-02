import { describe, expect, it } from 'vitest';

import {
  cleanRecipeLine,
  cleanRecipeLines,
  cleanRecipeNotes,
  isAllowedRecipeHost,
  parseRecipeLinkUrl,
  parseRecipeSourceUrl,
  planBulkImport,
  RECIPE_BULK_IMPORT_MAX_LINKS,
  RECIPE_IMPORT_HOSTS,
  RECIPE_LINK_IMPORTED_MESSAGE,
  RECIPE_INGREDIENT_MAX_LENGTH,
  RECIPE_INGREDIENTS_MAX,
  RECIPE_NOTES_MAX_LENGTH,
  RECIPE_SOURCE_PAGE_TITLE_MAX_LENGTH,
  RECIPE_SOURCE_URL_MAX_LENGTH,
  RECIPE_STEP_MAX_LENGTH,
  RECIPE_STEPS_MAX,
  RECIPE_TITLE_MAX_LENGTH,
  recipeTextLength,
  truncateRecipeDraft,
  truncateRecipeText,
  validateCreateRecipe,
  validateRecipeIngredients,
  validateRecipeLink,
  validateRecipeNotes,
  validateRecipeSource,
  validateRecipeSteps,
  validateRecipeTitle,
  validateRecipeVersion,
  validateUpdateRecipe,
} from './recipes';

const EMOJI = '\u{1f600}';
const LONE_HIGH = '\ud83d';
const LONE_LOW = '\ude00';

describe('recipe plain-text normalization', () => {
  it.each([
    ['  Fried   rice  ', 'Fried rice'],
    ['tab\tseparated', 'tab separated'],
    ['line\nbreak', 'line break'],
    ['nul\u0000byte', 'nulbyte'],
    ['bell\u0007and\u007fdelete\u009bc1', 'bellanddeletec1'],
    ['nel\u0085and\u2028separators\u2029', 'nel and separators'],
    ['ideographic\u3000space', 'ideographic space'],
    ['Cafe\u0301', 'Caf\u00e9'],
    ['大さじ２ しょうゆ', '大さじ２ しょうゆ'],
    ['½ cup', '½ cup'],
    [`o${LONE_LOW}k${LONE_HIGH}`, 'ok'],
    [`smile ${EMOJI}`, `smile ${EMOJI}`],
  ])('cleans %j to %j', (input, expected) => {
    expect(cleanRecipeLine(input)).toBe(expected);
  });

  it('keeps NFC composed text and full-width forms instead of folding them', () => {
    expect(cleanRecipeLine('Ｆｕｌｌ')).toBe('Ｆｕｌｌ');
    expect(cleanRecipeLine('Cafe\u0301')).toHaveLength(4);
  });

  it('keeps line breaks and single blank lines in notes', () => {
    expect(
      cleanRecipeNotes(
        '  first   line  \r\nsecond\rthird\r\n\r\n\r\n\r\n  fourth\u0000  ',
      ),
    ).toBe('first line\nsecond\nthird\n\nfourth');
    expect(cleanRecipeNotes('a\vb\fc\u2028d')).toBe('a\nb\nc\nd');
    expect(cleanRecipeNotes(' \n \t ')).toBe('');
  });

  it('drops lines that are empty after cleaning', () => {
    expect(cleanRecipeLines(['', '  ', 'salt', '\u0000', ' pepper '])).toEqual([
      'salt',
      'pepper',
    ]);
  });

  it('counts and truncates in code points, never splitting a surrogate pair', () => {
    expect(recipeTextLength(EMOJI.repeat(3))).toBe(3);
    expect(EMOJI.repeat(3)).toHaveLength(6);
    expect(truncateRecipeText(EMOJI.repeat(3), 2)).toBe(EMOJI.repeat(2));
    expect(truncateRecipeText('short', 10)).toBe('short');
    expect(truncateRecipeText('ab cd', 3)).toBe('ab');
  });
});

describe('recipe field validation', () => {
  it('accepts titles within bounds and rejects others', () => {
    expect(validateRecipeTitle('  Soup ')).toEqual({ ok: true, value: 'Soup' });
    expect(validateRecipeTitle(EMOJI.repeat(RECIPE_TITLE_MAX_LENGTH)).ok).toBe(
      true,
    );
    for (const bad of [
      '',
      '   ',
      'a'.repeat(RECIPE_TITLE_MAX_LENGTH + 1),
      3,
      null,
    ]) {
      expect(validateRecipeTitle(bad).ok, String(bad)).toBe(false);
    }
  });

  it('treats absent, null, and blank notes as no notes', () => {
    expect(validateRecipeNotes(undefined)).toEqual({ ok: true, value: null });
    expect(validateRecipeNotes(null)).toEqual({ ok: true, value: null });
    expect(validateRecipeNotes(' \n ')).toEqual({ ok: true, value: null });
    expect(validateRecipeNotes('n'.repeat(RECIPE_NOTES_MAX_LENGTH)).ok).toBe(
      true,
    );
    expect(
      validateRecipeNotes('n'.repeat(RECIPE_NOTES_MAX_LENGTH + 1)).ok,
    ).toBe(false);
    expect(validateRecipeNotes(4).ok).toBe(false);
  });

  it('bounds ingredient and step counts and line lengths after dropping empties', () => {
    const many = (count: number, text = 'x') =>
      Array.from({ length: count }, () => text);

    expect(validateRecipeIngredients(['a', '', 'b'])).toEqual({
      ok: true,
      value: ['a', 'b'],
    });
    expect(
      validateRecipeIngredients([...many(RECIPE_INGREDIENTS_MAX), '', ' ']).ok,
    ).toBe(true);
    expect(validateRecipeIngredients(many(RECIPE_INGREDIENTS_MAX + 1)).ok).toBe(
      false,
    );
    expect(
      validateRecipeIngredients(['x'.repeat(RECIPE_INGREDIENT_MAX_LENGTH)]).ok,
    ).toBe(true);
    const tooLong = validateRecipeIngredients([
      'ok',
      'x'.repeat(RECIPE_INGREDIENT_MAX_LENGTH + 1),
    ]);
    expect(tooLong).toEqual({
      ok: false,
      message: `Ingredient 2 is longer than ${RECIPE_INGREDIENT_MAX_LENGTH} characters.`,
    });

    expect(validateRecipeSteps(many(RECIPE_STEPS_MAX)).ok).toBe(true);
    expect(validateRecipeSteps(many(RECIPE_STEPS_MAX + 1)).ok).toBe(false);
    expect(
      validateRecipeSteps(['x'.repeat(RECIPE_STEP_MAX_LENGTH + 1)]).ok,
    ).toBe(false);

    for (const bad of [[], [''], 'text', null, [1], ['a', null]]) {
      expect(validateRecipeSteps(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('requires a positive whole version', () => {
    expect(validateRecipeVersion(3)).toEqual({ ok: true, value: 3 });
    for (const bad of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validateRecipeVersion(bad).ok, String(bad)).toBe(false);
    }
  });
});

describe('recipe source URL policy', () => {
  it('lists each allowed site with and without www', () => {
    expect(RECIPE_IMPORT_HOSTS).toHaveLength(14);
    for (const host of RECIPE_IMPORT_HOSTS.filter(
      (h) => !h.startsWith('www.'),
    )) {
      expect(isAllowedRecipeHost(`www.${host}`)).toBe(true);
    }
    expect(isAllowedRecipeHost('maangchi.com')).toBe(false);
  });

  it('accepts an allowlisted https URL and drops its fragment', () => {
    const parsed = parseRecipeSourceUrl(
      'https://WWW.BudgetBytes.com/recipe/?x=1#jump',
    );
    expect(parsed.ok && parsed.url.href).toBe(
      'https://www.budgetbytes.com/recipe/?x=1',
    );
    const explicitDefault = parseRecipeSourceUrl('https://kikkoman.co.jp:443/');
    expect(explicitDefault.ok).toBe(true);
  });

  it.each([
    ['not a url', 'malformed'],
    ['/relative/path', 'malformed'],
    ['http://budgetbytes.com/a', 'not_allowed'],
    ['javascript:alert(1)', 'not_allowed'],
    ['https://user:pass@budgetbytes.com/a', 'not_allowed'],
    ['https://budgetbytes.com:8443/a', 'not_allowed'],
    ['https://evil.budgetbytes.com/a', 'not_allowed'],
    ['https://budgetbytes.com.evil.test/a', 'not_allowed'],
    ['https://example.com/a', 'not_allowed'],
    [
      `https://budgetbytes.com/${'a'.repeat(RECIPE_SOURCE_URL_MAX_LENGTH)}`,
      'too_long',
    ],
  ])('refuses %s as %s', (value, problem) => {
    expect(parseRecipeSourceUrl(value)).toEqual({ ok: false, problem });
  });

  it('refuses a URL that only exceeds the bound once it is serialized', () => {
    const path = `${' '.repeat(RECIPE_SOURCE_URL_MAX_LENGTH - 30)}x`;
    // Each space becomes "%20" when the parser serializes the path.
    expect(parseRecipeSourceUrl(`https://budgetbytes.com/${path}`)).toEqual({
      ok: false,
      problem: 'too_long',
    });
  });
});

describe('manual recipe link', () => {
  it('accepts an https link from any host and drops its fragment', () => {
    const parsed = parseRecipeLinkUrl(
      'https://www.kikkoman.com.sg/product_recipes/soy-chicken/#steps',
    );
    expect(parsed.ok && parsed.url.href).toBe(
      'https://www.kikkoman.com.sg/product_recipes/soy-chicken/',
    );
    expect(isAllowedRecipeHost('www.kikkoman.com.sg')).toBe(false);
  });

  it.each([
    ['not a URL', 'kikkoman.com.sg/recipe', 'malformed'],
    ['http', 'http://example.com/rice', 'not_allowed'],
    ['credentials', 'https://user:pw@example.com/', 'not_allowed'],
    ['a port', 'https://example.com:8443/', 'not_allowed'],
    [
      'an over-length URL',
      `https://example.com/${'a'.repeat(RECIPE_SOURCE_URL_MAX_LENGTH)}`,
      'too_long',
    ],
  ])('refuses a link with %s', (_label, value, problem) => {
    expect(parseRecipeLinkUrl(value)).toEqual({ ok: false, problem });
  });

  it('treats absent, null, and blank links as no link and trims a link', () => {
    expect(validateRecipeLink(undefined)).toEqual({ ok: true, value: null });
    expect(validateRecipeLink(null)).toEqual({ ok: true, value: null });
    expect(validateRecipeLink('  ')).toEqual({ ok: true, value: null });
    expect(validateRecipeLink(' https://example.com/a ')).toEqual({
      ok: true,
      value: 'https://example.com/a',
    });
    expect(validateRecipeLink(7)).toEqual({
      ok: false,
      message: 'The recipe link must be text.',
    });
  });

  it('takes a link on a manual create and an update, but not on an import', () => {
    const content = { title: 'Soup', ingredients: ['water'], steps: ['Boil.'] };
    expect(
      validateCreateRecipe({ ...content, link: 'https://example.com/soup' }),
    ).toMatchObject({ ok: true, value: { link: 'https://example.com/soup' } });
    expect(
      validateUpdateRecipe({ version: 3, link: 'https://example.com/soup' }),
    ).toEqual({
      ok: true,
      value: { version: 3, link: 'https://example.com/soup' },
    });
    expect(validateUpdateRecipe({ version: 3, link: null })).toEqual({
      ok: true,
      value: { version: 3, link: null },
    });

    const imported = {
      ...content,
      source: {
        kind: 'website',
        submittedUrl: 'https://www.budgetbytes.com/soup/',
      },
    };
    expect(
      validateCreateRecipe({ ...imported, link: 'https://example.com/soup' }),
    ).toEqual({
      ok: false,
      errors: [{ field: 'link', message: RECIPE_LINK_IMPORTED_MESSAGE }],
    });
    expect(validateCreateRecipe({ ...imported, link: null })).toMatchObject({
      ok: true,
      value: { link: null },
    });
  });
});

describe('recipe source metadata', () => {
  it('defaults to manual and accepts an explicit manual source', () => {
    expect(validateRecipeSource(undefined)).toEqual({
      ok: true,
      value: { kind: 'manual' },
    });
    expect(validateRecipeSource({ kind: 'manual' })).toEqual({
      ok: true,
      value: { kind: 'manual' },
    });
  });

  it('derives the host from the page the text came from', () => {
    expect(
      validateRecipeSource({
        kind: 'website',
        submittedUrl: 'https://budgetbytes.com/a#b',
        resolvedUrl: 'https://www.budgetbytes.com/a',
        pageTitle: '  Page   Title ',
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: 'website',
        submittedUrl: 'https://budgetbytes.com/a',
        resolvedUrl: 'https://www.budgetbytes.com/a',
        host: 'www.budgetbytes.com',
        pageTitle: 'Page Title',
      },
    });

    expect(
      validateRecipeSource({
        kind: 'website',
        submittedUrl: 'https://budgetbytes.com/a',
        resolvedUrl: null,
        pageTitle: '   ',
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: 'website',
        submittedUrl: 'https://budgetbytes.com/a',
        resolvedUrl: null,
        host: 'budgetbytes.com',
        pageTitle: null,
      },
    });
  });

  it.each([
    ['a string', 'website'],
    ['null', null],
    ['an array', []],
    ['an unknown kind', { kind: 'photo' }],
    ['manual with extras', { kind: 'manual', host: 'x' }],
    [
      'a website with a client host',
      {
        kind: 'website',
        submittedUrl: 'https://budgetbytes.com/',
        host: 'budgetbytes.com',
      },
    ],
    ['a website without a URL', { kind: 'website' }],
    ['a non-string URL', { kind: 'website', submittedUrl: 1 }],
    [
      'an unsafe resolved URL',
      {
        kind: 'website',
        submittedUrl: 'https://budgetbytes.com/',
        resolvedUrl: 'http://budgetbytes.com/',
      },
    ],
    [
      'a non-string page title',
      {
        kind: 'website',
        submittedUrl: 'https://budgetbytes.com/',
        pageTitle: 5,
      },
    ],
    [
      'an overlong page title',
      {
        kind: 'website',
        submittedUrl: 'https://budgetbytes.com/',
        pageTitle: 'p'.repeat(RECIPE_SOURCE_PAGE_TITLE_MAX_LENGTH + 1),
      },
    ],
  ])('rejects %s', (_label, source) => {
    expect(validateRecipeSource(source).ok).toBe(false);
  });
});

describe('recipe request validation', () => {
  const valid = {
    title: ' Soup ',
    ingredients: ['water', ''],
    steps: ['Boil.'],
  };

  it('normalizes a valid create request', () => {
    expect(validateCreateRecipe({ ...valid, notes: 'Hot.' })).toEqual({
      ok: true,
      value: {
        title: 'Soup',
        notes: 'Hot.',
        ingredients: ['water'],
        steps: ['Boil.'],
        servings: null,
        link: null,
        source: { kind: 'manual' },
        onlyIfNewSource: false,
      },
    });
    expect(validateCreateRecipe({ ...valid, servings: 4 })).toMatchObject({
      ok: true,
      value: { servings: 4 },
    });
  });

  it('reports every invalid field of a create request at once', () => {
    const result = validateCreateRecipe({
      title: '',
      notes: 1,
      ingredients: [],
      steps: 'boil',
      source: { kind: 'photo' },
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((error) => error.field)).toEqual([
      'title',
      'notes',
      'ingredients',
      'steps',
      'source',
    ]);
  });

  it.each([
    ['a non-object', []],
    ['null', null],
    ['a client ID', { ...valid, id: 'x' }],
    ['a client version', { ...valid, version: 1 }],
    ['a client timestamp', { ...valid, updatedAt: 'x' }],
    ['a household', { ...valid, householdId: 'x' }],
  ])('rejects a create request with %s', (_label, input) => {
    const result = validateCreateRecipe(input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0].field).toBe('request');
  });

  it('accepts a partial update and normalizes each supplied field', () => {
    expect(
      validateUpdateRecipe({ version: 2, title: ' New ', notes: null }),
    ).toEqual({ ok: true, value: { version: 2, title: 'New', notes: null } });
    expect(
      validateUpdateRecipe({ version: 2, ingredients: ['a'], steps: ['b'] }),
    ).toEqual({
      ok: true,
      value: { version: 2, ingredients: ['a'], steps: ['b'] },
    });
  });

  it.each([
    ['a non-object', 'x', 'request'],
    ['no version', { title: 'x' }, 'request'],
    ['only a version', { version: 1 }, 'request'],
    ['a source change', { version: 1, source: { kind: 'manual' } }, 'request'],
    [
      'a client timestamp',
      { version: 1, title: 'x', createdAt: 'x' },
      'request',
    ],
    ['a bad version', { version: 0, title: 'x' }, 'version'],
    ['a bad title', { version: 1, title: '' }, 'title'],
    ['bad notes', { version: 1, notes: [] }, 'notes'],
    ['bad ingredients', { version: 1, ingredients: [] }, 'ingredients'],
    ['bad steps', { version: 1, steps: [''] }, 'steps'],
    ['a bad link', { version: 1, link: 'ftp://example.com/' }, 'link'],
  ])('rejects an update with %s', (_label, input, field) => {
    const result = validateUpdateRecipe(input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0].field).toBe(field);
  });
});

describe('import draft truncation', () => {
  it('leaves a draft within bounds unchanged apart from cleaning', () => {
    expect(
      truncateRecipeDraft({
        title: ' Soup ',
        ingredients: ['water', ''],
        steps: ['Boil.'],
        servings: 4,
      }),
    ).toEqual({
      draft: {
        title: 'Soup',
        ingredients: ['water'],
        steps: ['Boil.'],
        servings: 4,
      },
      notices: [],
    });
  });

  it('drops extra lines, cuts long lines, and reports each change', () => {
    const result = truncateRecipeDraft({
      title: EMOJI.repeat(RECIPE_TITLE_MAX_LENGTH + 5),
      ingredients: [
        'x'.repeat(RECIPE_INGREDIENT_MAX_LENGTH + 10),
        ...Array.from({ length: RECIPE_INGREDIENTS_MAX + 2 }, () => 'y'),
      ],
      steps: [
        ...Array.from({ length: RECIPE_STEPS_MAX - 1 }, () => 's'),
        'z'.repeat(RECIPE_STEP_MAX_LENGTH + 1),
        'dropped',
      ],
      servings: null,
    });

    expect(recipeTextLength(result.draft.title)).toBe(RECIPE_TITLE_MAX_LENGTH);
    expect(result.draft.ingredients).toHaveLength(RECIPE_INGREDIENTS_MAX);
    expect(result.draft.ingredients[0]).toHaveLength(
      RECIPE_INGREDIENT_MAX_LENGTH,
    );
    expect(result.draft.steps).toHaveLength(RECIPE_STEPS_MAX);
    expect(result.draft.steps.at(-1)).toHaveLength(RECIPE_STEP_MAX_LENGTH);
    expect(result.notices).toEqual([
      { field: 'title', count: 1 },
      { field: 'ingredients', count: 3 },
      { field: 'ingredientLines', count: 1 },
      { field: 'steps', count: 1 },
      { field: 'stepLines', count: 1 },
    ]);

    // A truncated draft always passes save-time validation.
    expect(
      validateCreateRecipe({ ...result.draft, source: undefined }).ok,
    ).toBe(true);
  });
});

describe('bulk import (#116)', () => {
  const website = {
    kind: 'website',
    submittedUrl: 'https://www.budgetbytes.com/soup/',
  } as const;
  const content = { title: 'Soup', ingredients: ['water'], steps: ['Boil.'] };

  describe('onlyIfNewSource', () => {
    it('is accepted with a website source and recorded', () => {
      expect(
        validateCreateRecipe({
          ...content,
          source: website,
          onlyIfNewSource: true,
        }),
      ).toMatchObject({ ok: true, value: { onlyIfNewSource: true } });
      expect(
        validateCreateRecipe({ ...content, source: website }),
      ).toMatchObject({ ok: true, value: { onlyIfNewSource: false } });
    });

    it('is a field error with a manual recipe', () => {
      for (const source of [undefined, { kind: 'manual' }]) {
        expect(
          validateCreateRecipe({ ...content, source, onlyIfNewSource: true }),
        ).toEqual({
          ok: false,
          errors: [
            {
              field: 'onlyIfNewSource',
              message:
                'Only a recipe imported from a website can skip a link already in the library.',
            },
          ],
        });
      }
    });

    it.each([false, 'true', 1, null])('refuses the value %j', (value) => {
      expect(
        validateCreateRecipe({
          ...content,
          source: website,
          onlyIfNewSource: value,
        }),
      ).toEqual({
        ok: false,
        errors: [
          {
            field: 'onlyIfNewSource',
            message: 'onlyIfNewSource must be true when it is sent.',
          },
        ],
      });
    });
  });

  describe('planBulkImport', () => {
    it('keeps the pasted order, trims lines, and ignores blank ones', () => {
      expect(
        planBulkImport(
          '\n  https://www.budgetbytes.com/a/  \r\n\n\thttps://recipetineats.com/b/\n   \n',
        ),
      ).toEqual({
        ok: true,
        lines: [
          {
            kind: 'import',
            line: 'https://www.budgetbytes.com/a/',
            url: 'https://www.budgetbytes.com/a/',
          },
          {
            kind: 'import',
            line: 'https://recipetineats.com/b/',
            url: 'https://recipetineats.com/b/',
          },
        ],
      });
    });

    it('refuses an empty paste', () => {
      expect(planBulkImport('')).toEqual({ ok: false, problem: 'empty' });
      expect(planBulkImport(' \n\t\r\n ')).toEqual({
        ok: false,
        problem: 'empty',
      });
    });

    it(`takes ${RECIPE_BULK_IMPORT_MAX_LINKS} links and refuses more before anything starts`, () => {
      const links = Array.from(
        { length: RECIPE_BULK_IMPORT_MAX_LINKS + 3 },
        (_unused, index) => `https://www.budgetbytes.com/recipe-${index}/`,
      );
      const twenty = planBulkImport(
        links.slice(0, RECIPE_BULK_IMPORT_MAX_LINKS).join('\n\n'),
      );
      expect(twenty.ok && twenty.lines).toHaveLength(
        RECIPE_BULK_IMPORT_MAX_LINKS,
      );
      // Every non-blank line counts, including ones that are not links.
      expect(
        planBulkImport(
          [...links.slice(0, RECIPE_BULK_IMPORT_MAX_LINKS), 'soup'].join('\n'),
        ),
      ).toEqual({ ok: false, problem: 'too_many', count: 21 });
      expect(planBulkImport(links.join('\n'))).toEqual({
        ok: false,
        problem: 'too_many',
        count: 23,
      });
    });

    it('refuses lines the import itself would refuse, with the reason', () => {
      const plan = planBulkImport(
        [
          'not a link',
          'https://example.com/soup',
          'http://www.budgetbytes.com/soup/',
          'https://user:pass@www.budgetbytes.com/soup/',
          `https://www.budgetbytes.com/${'a'.repeat(RECIPE_SOURCE_URL_MAX_LENGTH)}`,
        ].join('\n'),
      );
      expect(plan.ok && plan.lines.map((line) => line.kind)).toEqual(
        Array(5).fill('refused'),
      );
      expect(
        plan.ok &&
          plan.lines.map((line) => line.kind === 'refused' && line.problem),
      ).toEqual([
        'malformed',
        'not_allowed',
        'not_allowed',
        'not_allowed',
        'too_long',
      ]);
    });

    it('marks a link pasted again, once its fragment is removed, as a repeat', () => {
      const plan = planBulkImport(
        [
          'https://www.budgetbytes.com/soup/#wprm-recipe',
          'https://www.budgetbytes.com/soup/',
          'https://WWW.BUDGETBYTES.COM/soup/#comments',
          'https://budgetbytes.com/soup/',
        ].join('\n'),
      );
      expect(plan).toEqual({
        ok: true,
        lines: [
          {
            kind: 'import',
            line: 'https://www.budgetbytes.com/soup/#wprm-recipe',
            url: 'https://www.budgetbytes.com/soup/',
          },
          {
            kind: 'repeat',
            line: 'https://www.budgetbytes.com/soup/',
            url: 'https://www.budgetbytes.com/soup/',
          },
          {
            kind: 'repeat',
            line: 'https://WWW.BUDGETBYTES.COM/soup/#comments',
            url: 'https://www.budgetbytes.com/soup/',
          },
          // A different host is a different address; the Worker's duplicate
          // check decides whether it is the same recipe.
          {
            kind: 'import',
            line: 'https://budgetbytes.com/soup/',
            url: 'https://budgetbytes.com/soup/',
          },
        ],
      });
    });
  });
});
