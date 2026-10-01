import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  seedPantryItem,
  seedRecipe,
  testEnv,
} from './helpers';

describe('household identity migration', () => {
  beforeEach(applyMigrations);

  it('applies the real ordered migration and creates all identity tables', async () => {
    const tables = await testEnv.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('households', 'household_members', 'app_installation')
        ORDER BY name`,
    ).all<{ name: string }>();

    expect(tables.results.map(({ name }) => name)).toEqual([
      'app_installation',
      'household_members',
      'households',
    ]);
  });

  it('enforces singleton installation and globally unique identity fields', async () => {
    const now = new Date().toISOString();
    const householdOne = crypto.randomUUID();
    const householdTwo = crypto.randomUUID();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO households (id, name, created_at, updated_at)
         VALUES (?, 'One', ?, ?)`,
      ).bind(householdOne, now, now),
      testEnv.DB.prepare(
        `INSERT INTO households (id, name, created_at, updated_at)
         VALUES (?, 'Two', ?, ?)`,
      ).bind(householdTwo, now, now),
      testEnv.DB.prepare(
        `INSERT INTO app_installation (singleton_id, household_id, created_at)
         VALUES (1, ?, ?)`,
      ).bind(householdOne, now),
    ]);

    await expect(
      testEnv.DB.prepare(
        `INSERT INTO app_installation (singleton_id, household_id, created_at)
         VALUES (1, ?, ?)`,
      )
        .bind(householdTwo, now)
        .run(),
    ).rejects.toThrow();

    await testEnv.DB.prepare(
      `INSERT INTO household_members (
         id, household_id, normalized_email, access_subject, role, status,
         invited_at, activated_at, revoked_at, created_at, updated_at
       ) VALUES (?, ?, 'member@example.test', ?, 'member', 'active', ?, ?, NULL, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        householdOne,
        'subject-one',
        now,
        now,
        now,
        now,
      )
      .run();

    await expect(
      testEnv.DB.prepare(
        `INSERT INTO household_members (
           id, household_id, normalized_email, access_subject, role, status,
           invited_at, activated_at, revoked_at, created_at, updated_at
         ) VALUES (?, ?, 'member@example.test', ?, 'member', 'active', ?, ?, NULL, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          householdTwo,
          'subject-two',
          now,
          now,
          now,
          now,
        )
        .run(),
    ).rejects.toThrow();
  });

  it('enforces unique Access subjects independently of member email', async () => {
    const now = new Date().toISOString();
    const household = crypto.randomUUID();
    await testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at)
       VALUES (?, 'Family', ?, ?)`,
    )
      .bind(household, now, now)
      .run();

    const insertActiveMember = (email: string) =>
      testEnv.DB.prepare(
        `INSERT INTO household_members (
           id, household_id, normalized_email, access_subject, role, status,
           invited_at, activated_at, revoked_at, created_at, updated_at
         ) VALUES (?, ?, ?, 'shared-subject', 'member', 'active', ?, ?, NULL, ?, ?)`,
      )
        .bind(crypto.randomUUID(), household, email, now, now, now, now)
        .run();

    await insertActiveMember('first@example.test');
    await expect(insertActiveMember('second@example.test')).rejects.toThrow();
  });

  it('enforces household ownership and membership lifecycle constraints', async () => {
    const now = new Date().toISOString();
    const household = crypto.randomUUID();
    await testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at)
       VALUES (?, 'Family', ?, ?)`,
    )
      .bind(household, now, now)
      .run();

    const insertMember = (
      householdId: string,
      email: string,
      subject: string | null,
      status: string,
      activatedAt: string | null,
      revokedAt: string | null,
    ) =>
      testEnv.DB.prepare(
        `INSERT INTO household_members (
           id, household_id, normalized_email, access_subject, role, status,
           invited_at, activated_at, revoked_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'member', ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          householdId,
          email,
          subject,
          status,
          now,
          activatedAt,
          revokedAt,
          now,
          now,
        )
        .run();

    await expect(
      insertMember(
        crypto.randomUUID(),
        'orphan@example.test',
        null,
        'invited',
        null,
        null,
      ),
    ).rejects.toThrow();
    await expect(
      insertMember(
        household,
        'invalid-invite@example.test',
        'subject',
        'invited',
        null,
        null,
      ),
    ).rejects.toThrow();
    await expect(
      insertMember(
        household,
        'invalid-active@example.test',
        'subject',
        'active',
        null,
        null,
      ),
    ).rejects.toThrow();
    await expect(
      insertMember(
        household,
        'invalid-revoked@example.test',
        'subject',
        'revoked',
        now,
        null,
      ),
    ).rejects.toThrow();
  });
});

describe('pantry migration', () => {
  beforeEach(applyMigrations);

  it('applies 0002 on top of the Phase 1 schema without altering it', async () => {
    const tables = await testEnv.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('households', 'household_members', 'app_installation', 'pantry_items')
        ORDER BY name`,
    ).all<{ name: string }>();

    expect(tables.results.map(({ name }) => name)).toEqual([
      'app_installation',
      'household_members',
      'households',
      'pantry_items',
    ]);
  });

  it('rejects an invalid status, a non-positive version, and a foreign source', async () => {
    const now = new Date().toISOString();
    const householdId = crypto.randomUUID();
    await testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at)
       VALUES (?, 'Pantry Family', ?, ?)`,
    )
      .bind(householdId, now, now)
      .run();

    const insert = (
      status: string,
      version: number,
      source: string,
    ): Promise<unknown> =>
      testEnv.DB.prepare(
        `INSERT INTO pantry_items (
           id, household_id, display_name, normalized_name, status,
           version, created_source, created_at, updated_at
         ) VALUES (?, ?, 'x', ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          householdId,
          crypto.randomUUID(),
          status,
          version,
          source,
          now,
          now,
        )
        .run();

    await expect(insert('plenty', 1, 'manual')).rejects.toThrow();
    await expect(insert('available', 0, 'manual')).rejects.toThrow();
    await expect(insert('available', 1, 'photo')).rejects.toThrow();
    await expect(insert('available', 1, 'manual')).resolves.toBeDefined();
  });

  it('scopes name uniqueness to one household and cascades on household delete', async () => {
    const now = new Date().toISOString();
    const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO households (id, name, created_at, updated_at)
         VALUES (?, 'One', ?, ?)`,
      ).bind(first, now, now),
      testEnv.DB.prepare(
        `INSERT INTO households (id, name, created_at, updated_at)
         VALUES (?, 'Two', ?, ?)`,
      ).bind(second, now, now),
    ]);

    await seedPantryItem(first, 'rice');
    // The same name is fine in another household.
    await expect(seedPantryItem(second, 'rice')).resolves.toBeDefined();
    // ...but not twice in the same one.
    await expect(seedPantryItem(first, 'rice')).rejects.toThrow();

    await testEnv.DB.prepare('DELETE FROM households WHERE id = ?')
      .bind(first)
      .run();
    const remaining = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS total FROM pantry_items WHERE household_id = ?',
    )
      .bind(first)
      .first<{ total: number }>();

    expect(remaining?.total).toBe(0);
  });
});

describe('recipe migration', () => {
  beforeEach(applyMigrations);

  const seedHousehold = async (name = 'Recipe Family'): Promise<string> => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(id, name, now, now)
      .run();
    return id;
  };

  interface RecipeColumns {
    title?: string;
    notes?: string | null;
    version?: number;
    writeToken?: string;
    sourceKind?: string;
    submittedUrl?: string | null;
    resolvedUrl?: string | null;
    host?: string | null;
    pageTitle?: string | null;
    importedAt?: string | null;
  }

  const insertRecipe = (
    householdId: string,
    columns: RecipeColumns = {},
  ): Promise<unknown> => {
    const now = new Date().toISOString();
    return testEnv.DB.prepare(
      `INSERT INTO recipes (
         id, household_id, title, notes, version, write_token, source_kind,
         source_submitted_url, source_resolved_url, source_host,
         source_page_title, source_imported_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        householdId,
        columns.title ?? 'Soup',
        columns.notes ?? null,
        columns.version ?? 1,
        columns.writeToken ?? 'token',
        columns.sourceKind ?? 'manual',
        columns.submittedUrl ?? null,
        columns.resolvedUrl ?? null,
        columns.host ?? null,
        columns.pageTitle ?? null,
        columns.importedAt ?? null,
        now,
        now,
      )
      .run();
  };

  const insertLine = (
    table: 'recipe_ingredients' | 'recipe_steps',
    recipeId: string,
    position: number,
    text: string,
  ): Promise<unknown> =>
    testEnv.DB.prepare(
      `INSERT INTO ${table} (recipe_id, position, text) VALUES (?, ?, ?)`,
    )
      .bind(recipeId, position, text)
      .run();

  it('applies 0003 on top of the existing schema without altering it', async () => {
    const tables = await testEnv.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('households', 'household_members', 'app_installation',
                       'pantry_items', 'recipes', 'recipe_ingredients',
                       'recipe_steps')
        ORDER BY name`,
    ).all<{ name: string }>();

    expect(tables.results.map(({ name }) => name)).toEqual([
      'app_installation',
      'household_members',
      'households',
      'pantry_items',
      'recipe_ingredients',
      'recipe_steps',
      'recipes',
    ]);

    const index = await testEnv.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'recipes_household_updated_idx'`,
    ).first<{ name: string }>();
    expect(index?.name).toBe('recipes_household_updated_idx');
  });

  it('enforces title, notes, version, and source-kind constraints', async () => {
    const householdId = await seedHousehold();

    await expect(insertRecipe(householdId, { title: '' })).rejects.toThrow();
    await expect(
      insertRecipe(householdId, { title: 'a'.repeat(121) }),
    ).rejects.toThrow();
    await expect(insertRecipe(householdId, { notes: '' })).rejects.toThrow();
    await expect(
      insertRecipe(householdId, { notes: 'n'.repeat(4001) }),
    ).rejects.toThrow();
    await expect(insertRecipe(householdId, { version: 0 })).rejects.toThrow();
    await expect(
      insertRecipe(householdId, { writeToken: '' }),
    ).rejects.toThrow();
    await expect(
      insertRecipe(householdId, { sourceKind: 'photo' }),
    ).rejects.toThrow();
    await expect(
      insertRecipe(crypto.randomUUID(), { title: 'Orphan' }),
    ).rejects.toThrow();

    // Bounds count code points, as the shared validation does.
    await expect(
      insertRecipe(householdId, {
        title: '😀'.repeat(120),
        notes: '😀'.repeat(4000),
      }),
    ).resolves.toBeDefined();
  });

  it('requires a website row to carry its link and a manual row to carry none', async () => {
    const householdId = await seedHousehold();
    const now = new Date().toISOString();
    const site = {
      sourceKind: 'website',
      submittedUrl: 'https://budgetbytes.com/a',
      host: 'budgetbytes.com',
      importedAt: now,
    };

    await expect(insertRecipe(householdId, site)).resolves.toBeDefined();
    await expect(
      insertRecipe(householdId, {
        ...site,
        resolvedUrl: 'https://www.budgetbytes.com/a',
        pageTitle: 'A',
      }),
    ).resolves.toBeDefined();

    for (const missing of [
      { submittedUrl: null },
      { host: null },
      { importedAt: null },
    ]) {
      await expect(
        insertRecipe(householdId, { ...site, ...missing }),
      ).rejects.toThrow();
    }
    for (const extra of [
      { submittedUrl: 'https://budgetbytes.com/a' },
      { resolvedUrl: 'https://budgetbytes.com/a' },
      { host: 'budgetbytes.com' },
      { pageTitle: 'A' },
      { importedAt: now },
    ]) {
      await expect(insertRecipe(householdId, extra)).rejects.toThrow();
    }

    await expect(
      insertRecipe(householdId, {
        ...site,
        submittedUrl: `https://budgetbytes.com/${'a'.repeat(2048)}`,
      }),
    ).rejects.toThrow();
    await expect(
      insertRecipe(householdId, {
        ...site,
        resolvedUrl: `https://budgetbytes.com/${'a'.repeat(2048)}`,
      }),
    ).rejects.toThrow();
    await expect(
      insertRecipe(householdId, { ...site, pageTitle: 't'.repeat(201) }),
    ).rejects.toThrow();
    await expect(
      insertRecipe(householdId, { ...site, host: '' }),
    ).rejects.toThrow();
  });

  it('bounds line positions and text and keeps positions unique per recipe', async () => {
    const householdId = await seedHousehold();
    const recipeId = await seedRecipe(householdId, 'Lines', {
      ingredients: [],
      steps: [],
    });

    await expect(
      insertLine('recipe_ingredients', recipeId, 1, 'salt'),
    ).resolves.toBeDefined();
    await expect(
      insertLine('recipe_ingredients', recipeId, 1, 'pepper'),
    ).rejects.toThrow();
    await expect(
      insertLine('recipe_ingredients', recipeId, 0, 'zero'),
    ).rejects.toThrow();
    await expect(
      insertLine('recipe_ingredients', recipeId, 101, 'too far'),
    ).rejects.toThrow();
    await expect(
      insertLine('recipe_ingredients', recipeId, 2, ''),
    ).rejects.toThrow();
    await expect(
      insertLine('recipe_ingredients', recipeId, 2, 'x'.repeat(301)),
    ).rejects.toThrow();
    await expect(
      insertLine('recipe_ingredients', recipeId, 100, 'x'.repeat(300)),
    ).resolves.toBeDefined();

    await expect(
      insertLine('recipe_steps', recipeId, 50, 'x'.repeat(2000)),
    ).resolves.toBeDefined();
    await expect(
      insertLine('recipe_steps', recipeId, 51, 'late'),
    ).rejects.toThrow();
    await expect(
      insertLine('recipe_steps', recipeId, 1, 'x'.repeat(2001)),
    ).rejects.toThrow();
    await expect(
      insertLine('recipe_steps', crypto.randomUUID(), 1, 'orphan'),
    ).rejects.toThrow();
  });

  it('cascades lines on recipe delete and recipes on household delete', async () => {
    const [first, second] = [
      await seedHousehold('One'),
      await seedHousehold('Two'),
    ];
    const doomed = await seedRecipe(first, 'Doomed', {
      ingredients: ['a', 'b'],
      steps: ['c'],
    });
    const survivor = await seedRecipe(first, 'Survivor');
    const elsewhere = await seedRecipe(second, 'Elsewhere');

    await testEnv.DB.prepare('DELETE FROM recipes WHERE id = ?')
      .bind(doomed)
      .run();
    const count = async (sql: string, ...values: string[]) =>
      (
        await testEnv.DB.prepare(sql)
          .bind(...values)
          .first<{ total: number }>()
      )?.total;

    expect(
      await count(
        'SELECT COUNT(*) AS total FROM recipe_ingredients WHERE recipe_id = ?',
        doomed,
      ),
    ).toBe(0);
    expect(
      await count(
        'SELECT COUNT(*) AS total FROM recipe_steps WHERE recipe_id = ?',
        doomed,
      ),
    ).toBe(0);

    // The installation pointer restricts household deletion; the #32 operator
    // batch clears it first, then deletes the household.
    const now = new Date().toISOString();
    await testEnv.DB.prepare(
      `INSERT INTO app_installation (singleton_id, household_id, created_at)
       VALUES (1, ?, ?)`,
    )
      .bind(first, now)
      .run();
    await expect(
      testEnv.DB.prepare('DELETE FROM households WHERE id = ?')
        .bind(first)
        .run(),
    ).rejects.toThrow();

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        'DELETE FROM app_installation WHERE household_id = ?',
      ).bind(first),
      testEnv.DB.prepare('DELETE FROM households WHERE id = ?').bind(first),
    ]);

    expect(
      await count(
        'SELECT COUNT(*) AS total FROM recipes WHERE household_id = ?',
        first,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT COUNT(*) AS total FROM recipe_ingredients WHERE recipe_id IN (?, ?)`,
        doomed,
        survivor,
      ),
    ).toBe(0);
    expect(
      await count(
        'SELECT COUNT(*) AS total FROM recipe_steps WHERE recipe_id = ?',
        survivor,
      ),
    ).toBe(0);
    expect(
      await count(
        'SELECT COUNT(*) AS total FROM recipe_ingredients WHERE recipe_id = ?',
        elsewhere,
      ),
    ).toBe(1);
  });
});

describe('meal plan migration', () => {
  beforeEach(applyMigrations);

  const seedHousehold = async (): Promise<string> => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at)
       VALUES (?, 'Plan Family', ?, ?)`,
    )
      .bind(id, now, now)
      .run();
    return id;
  };

  interface EntryColumns {
    date?: string;
    slot?: string;
    kind?: string;
    recipeId?: string | null;
    title?: string;
    note?: string | null;
    version?: number;
  }

  const insertEntry = (
    householdId: string,
    columns: EntryColumns = {},
  ): Promise<unknown> => {
    const now = new Date().toISOString();
    return testEnv.DB.prepare(
      `INSERT INTO meal_plan_entries (
         id, household_id, plan_date, meal_slot, kind, recipe_id, title, note,
         placed_at, version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        householdId,
        columns.date ?? '2026-09-24',
        columns.slot ?? 'dinner',
        columns.kind ?? 'text',
        columns.recipeId ?? null,
        columns.title ?? 'Leftovers',
        columns.note ?? null,
        now,
        columns.version ?? 1,
        now,
        now,
      )
      .run();
  };

  it('applies 0004 on top of the existing schema without altering it', async () => {
    const tables = await testEnv.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
          AND name IN ('households', 'recipes', 'meal_plan_entries')
        ORDER BY name`,
    ).all<{ name: string }>();
    expect(tables.results.map(({ name }) => name)).toEqual([
      'households',
      'meal_plan_entries',
      'recipes',
    ]);

    const indexes = await testEnv.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'meal_plan_entries'
          AND name NOT LIKE 'sqlite_autoindex%'
        ORDER BY name`,
    ).all<{ name: string }>();
    expect(indexes.results.map(({ name }) => name)).toEqual([
      'meal_plan_entries_household_date_idx',
      'meal_plan_entries_recipe_idx',
    ]);
  });

  it('accepts only real YYYY-MM-DD dates through the date() CHECK', async () => {
    const householdId = await seedHousehold();

    for (const date of ['2024-02-29', '2026-12-31', '2026-01-01']) {
      await expect(insertEntry(householdId, { date })).resolves.toBeDefined();
    }
    // An impossible date, malformed dates for which date() returns NULL, and
    // a timestamp. The CHECK uses IS, because a CHECK that evaluates to NULL
    // passes: `date(plan_date) = plan_date` would accept '2026-2-3'.
    for (const date of [
      '2026-02-30',
      '2025-02-29',
      '2026-13-01',
      '2026-2-3',
      'tomorrow',
      '',
      '2026-02-03 ',
      '2026-02-03T00:00',
    ]) {
      await expect(insertEntry(householdId, { date }), date).rejects.toThrow(
        /CHECK/u,
      );
    }
  });

  it('enforces slot, kind, recipe link, text bounds, and version', async () => {
    const householdId = await seedHousehold();

    await expect(insertEntry(householdId, { slot: 'snack' })).rejects.toThrow();
    await expect(insertEntry(householdId, { kind: 'note' })).rejects.toThrow();
    await expect(insertEntry(householdId, { title: '' })).rejects.toThrow();
    await expect(
      insertEntry(householdId, { title: 't'.repeat(121) }),
    ).rejects.toThrow();
    await expect(insertEntry(householdId, { note: '' })).rejects.toThrow();
    await expect(
      insertEntry(householdId, { note: 'n'.repeat(201) }),
    ).rejects.toThrow();
    await expect(insertEntry(householdId, { version: 0 })).rejects.toThrow();

    const recipeId = await seedRecipe(householdId, 'Soup');
    // A text entry can never carry a recipe link.
    await expect(
      insertEntry(householdId, { kind: 'text', recipeId }),
    ).rejects.toThrow(/CHECK/u);
    // A recipe link must name an existing recipe.
    await expect(
      insertEntry(householdId, {
        kind: 'recipe',
        recipeId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/FOREIGN KEY/u);

    await expect(
      insertEntry(householdId, {
        kind: 'recipe',
        recipeId,
        title: 't'.repeat(120),
        note: 'n'.repeat(200),
      }),
    ).resolves.toBeDefined();
  });

  it('keeps an entry when its recipe is deleted and cascades on household delete', async () => {
    const householdId = await seedHousehold();
    const otherId = await seedHousehold();
    const recipeId = await seedRecipe(householdId, 'Soup');
    await insertEntry(householdId, { kind: 'recipe', recipeId, title: 'Soup' });
    await insertEntry(otherId);

    await testEnv.DB.prepare('DELETE FROM recipes WHERE id = ?')
      .bind(recipeId)
      .run();
    const kept = await testEnv.DB.prepare(
      'SELECT kind, recipe_id, title FROM meal_plan_entries WHERE household_id = ?',
    )
      .bind(householdId)
      .first();
    expect(kept).toEqual({ kind: 'recipe', recipe_id: null, title: 'Soup' });

    await testEnv.DB.prepare('DELETE FROM households WHERE id = ?')
      .bind(householdId)
      .run();
    const remaining = await testEnv.DB.prepare(
      'SELECT household_id FROM meal_plan_entries',
    ).all<{ household_id: string }>();
    expect(remaining.results).toEqual([{ household_id: otherId }]);
  });
});

describe('recipe preference migration', () => {
  beforeEach(applyMigrations);

  const seedHousehold = async (): Promise<string> => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at)
       VALUES (?, 'Preference Family', ?, ?)`,
    )
      .bind(id, now, now)
      .run();
    return id;
  };

  const insertPreference = (
    householdId: string,
    recipeId: string,
    favourite: number,
    notNowUntil: string | null,
  ): Promise<unknown> =>
    testEnv.DB.prepare(
      `INSERT INTO recipe_preferences (
         recipe_id, household_id, favourite, not_now_until, updated_at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        recipeId,
        householdId,
        favourite,
        notNowUntil,
        new Date().toISOString(),
      )
      .run();

  it('applies 0005 on top of the existing schema without altering it', async () => {
    const tables = await testEnv.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
          AND name IN ('recipes', 'recipe_preferences')
        ORDER BY name`,
    ).all<{ name: string }>();
    expect(tables.results.map(({ name }) => name)).toEqual([
      'recipe_preferences',
      'recipes',
    ]);
    const indexes = await testEnv.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'recipe_preferences'
          AND name NOT LIKE 'sqlite_autoindex%'`,
    ).all<{ name: string }>();
    expect(indexes.results.map(({ name }) => name)).toEqual([
      'recipe_preferences_household_idx',
    ]);
  });

  it('accepts a favourite, a Not now instant, or both, once per recipe', async () => {
    const householdId = await seedHousehold();
    const first = await seedRecipe(householdId, 'Soup');
    const second = await seedRecipe(householdId, 'Stew');
    const third = await seedRecipe(householdId, 'Bake');
    await insertPreference(householdId, first, 1, null);
    await insertPreference(householdId, second, 0, '2026-10-01T12:00:00.000Z');
    await insertPreference(householdId, third, 1, '2026-10-01T12:00:00.000Z');
    await expect(insertPreference(householdId, first, 1, null)).rejects.toThrow(
      /UNIQUE|PRIMARY/iu,
    );
  });

  it.each([
    ['a favourite that is not 0 or 1', 2, null],
    ['a row that holds no preference', 0, null],
    ['a date without a time', 0, '2026-10-01'],
    ['text that is not a time', 0, 'next week'],
    ['an instant without milliseconds', 0, '2026-10-01T12:00:00Z'],
    ['an impossible instant', 0, '2026-02-30T12:00:00.000Z'],
  ])('rejects %s', async (_name, favourite, notNowUntil) => {
    const householdId = await seedHousehold();
    const recipeId = await seedRecipe(householdId, 'Soup');
    await expect(
      insertPreference(householdId, recipeId, favourite, notNowUntil),
    ).rejects.toThrow(/CHECK/iu);
  });

  it('cascades from both the recipe and the household', async () => {
    const householdId = await seedHousehold();
    const otherId = await seedHousehold();
    const soup = await seedRecipe(householdId, 'Soup');
    const stew = await seedRecipe(householdId, 'Stew');
    const theirs = await seedRecipe(otherId, 'Theirs');
    await insertPreference(householdId, soup, 1, null);
    await insertPreference(householdId, stew, 1, null);
    await insertPreference(otherId, theirs, 1, null);

    await testEnv.DB.prepare('DELETE FROM recipes WHERE id = ?')
      .bind(soup)
      .run();
    await testEnv.DB.prepare('DELETE FROM households WHERE id = ?')
      .bind(householdId)
      .run();
    const remaining = await testEnv.DB.prepare(
      'SELECT recipe_id FROM recipe_preferences',
    ).all<{ recipe_id: string }>();
    expect(remaining.results).toEqual([{ recipe_id: theirs }]);
  });
});

describe('recipe nutrition migration', () => {
  beforeEach(applyMigrations);

  const seedHousehold = async (): Promise<string> => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at)
       VALUES (?, 'Nutrition Family', ?, ?)`,
    )
      .bind(id, now, now)
      .run();
    return id;
  };

  interface MatchValues {
    position?: number;
    lineText?: string;
    fdcId?: number | null;
    quantity?: number | null;
    unit?: string | null;
    grams?: number | null;
    confirmedAt?: string;
  }

  const insertMatch = (
    householdId: string,
    recipeId: string,
    values: MatchValues = {},
  ): Promise<unknown> =>
    testEnv.DB.prepare(
      `INSERT INTO recipe_ingredient_matches (
         recipe_id, position, household_id, line_text, fdc_id, quantity,
         unit, grams, confirmed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        recipeId,
        values.position ?? 1,
        householdId,
        values.lineText ?? '2 eggs',
        values.fdcId === undefined ? 171287 : values.fdcId,
        values.quantity === undefined ? 2 : values.quantity,
        values.unit === undefined ? 'portion:1' : values.unit,
        values.grams === undefined ? 100 : values.grams,
        values.confirmedAt ?? '2026-09-26T08:00:00.000Z',
      )
      .run();

  it('applies 0006 on top of the existing schema, adding only a nullable servings column to recipes', async () => {
    const columns = await testEnv.DB.prepare(
      'SELECT name, "notnull" FROM pragma_table_info(\'recipes\')',
    ).all<{ name: string; notnull: number }>();
    // 0007 adds link_url after it (#113).
    expect(columns.results.at(-2)).toEqual({ name: 'servings', notnull: 0 });
    const tables = await testEnv.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND (name LIKE 'nutrition%' OR name = 'recipe_ingredient_matches')
        ORDER BY name`,
    ).all<{ name: string }>();
    expect(tables.results.map(({ name }) => name)).toEqual([
      'nutrition_dataset',
      'nutrition_food_portions',
      'nutrition_foods',
      'nutrition_foods_fts',
      'nutrition_foods_fts_config',
      'nutrition_foods_fts_data',
      'nutrition_foods_fts_docsize',
      'nutrition_foods_fts_idx',
      'recipe_ingredient_matches',
    ]);
    const matchColumns = await testEnv.DB.prepare(
      "SELECT name FROM pragma_table_info('recipe_ingredient_matches')",
    ).all<{ name: string }>();
    // No member identity is stored with a match.
    expect(matchColumns.results.map(({ name }) => name)).toEqual([
      'recipe_id',
      'position',
      'household_id',
      'line_text',
      'fdc_id',
      'quantity',
      'unit',
      'grams',
      'confirmed_at',
    ]);
  });

  it('bounds servings to 1–50 or NULL', async () => {
    const householdId = await seedHousehold();
    const recipeId = await seedRecipe(householdId, 'Soup');
    const setServings = (value: unknown) =>
      testEnv.DB.prepare('UPDATE recipes SET servings = ? WHERE id = ?')
        .bind(value, recipeId)
        .run();
    for (const valid of [1, 50, null]) await setServings(valid);
    for (const invalid of [0, 51, -1]) {
      await expect(setServings(invalid), String(invalid)).rejects.toThrow(
        /CHECK/iu,
      );
    }
    await expect(setServings('four')).rejects.toThrow(/cannot store|CHECK/iu);
  });

  it('accepts a counted match or a "Don\'t count" match, once per line', async () => {
    const householdId = await seedHousehold();
    const recipeId = await seedRecipe(householdId, 'Soup');
    await insertMatch(householdId, recipeId);
    await insertMatch(householdId, recipeId, {
      position: 2,
      fdcId: null,
      quantity: null,
      unit: null,
      grams: null,
    });
    await expect(insertMatch(householdId, recipeId)).rejects.toThrow(
      /UNIQUE|PRIMARY/iu,
    );
  });

  it.each<[string, MatchValues]>([
    ['a food without an amount', { quantity: null }],
    ['a food without a unit', { unit: null }],
    ['a food without grams', { grams: null }],
    ['an amount without a food', { fdcId: null }],
    ['a zero quantity', { quantity: 0 }],
    ['a quantity over 10,000', { quantity: 10_001 }],
    ['grams over 10,000', { grams: 10_001 }],
    ['zero grams', { grams: 0 }],
    ['an empty unit', { unit: '' }],
    ['position 0', { position: 0 }],
    ['position 101', { position: 101 }],
    ['an empty line', { lineText: '' }],
    ['a malformed confirmation time', { confirmedAt: 'yesterday' }],
    ['a date without a time', { confirmedAt: '2026-09-26' }],
  ])('refuses %s', async (_name, values) => {
    const householdId = await seedHousehold();
    const recipeId = await seedRecipe(householdId, 'Soup');
    await expect(insertMatch(householdId, recipeId, values)).rejects.toThrow(
      /CHECK/iu,
    );
  });

  it('cascades matches from both the recipe and the household', async () => {
    const householdId = await seedHousehold();
    const otherId = await seedHousehold();
    const soup = await seedRecipe(householdId, 'Soup');
    const stew = await seedRecipe(householdId, 'Stew');
    const theirs = await seedRecipe(otherId, 'Theirs');
    await insertMatch(householdId, soup);
    await insertMatch(householdId, stew);
    await insertMatch(otherId, theirs);

    await testEnv.DB.prepare('DELETE FROM recipes WHERE id = ?')
      .bind(soup)
      .run();
    await testEnv.DB.prepare('DELETE FROM households WHERE id = ?')
      .bind(householdId)
      .run();
    const remaining = await testEnv.DB.prepare(
      'SELECT recipe_id FROM recipe_ingredient_matches',
    ).all<{ recipe_id: string }>();
    expect(remaining.results).toEqual([{ recipe_id: theirs }]);
  });

  it('bounds the reference data and cascades portions from their food', async () => {
    const food = (fdcId: number, dataType = 'sr_legacy') =>
      testEnv.DB.prepare(
        `INSERT INTO nutrition_foods (fdc_id, name, data_type, category, release)
         VALUES (?, 'Test food', ?, 'Tests', '2018-04')`,
      )
        .bind(fdcId, dataType)
        .run();
    await food(1);
    await expect(food(2, 'branded')).rejects.toThrow(/CHECK/iu);
    const portion = (amount: number, gramWeight: number) =>
      testEnv.DB.prepare(
        `INSERT INTO nutrition_food_portions (fdc_id, seq, amount, label, gram_weight)
         VALUES (1, ?, ?, 'cup', ?)`,
      )
        .bind(amount * 10 + gramWeight, amount, gramWeight)
        .run();
    await portion(1, 240);
    await expect(portion(0, 240)).rejects.toThrow(/CHECK/iu);
    await expect(portion(1, 0)).rejects.toThrow(/CHECK/iu);
    await testEnv.DB.prepare('DELETE FROM nutrition_foods').run();
    const left = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS portions FROM nutrition_food_portions',
    ).first<{ portions: number }>();
    expect(left?.portions).toBe(0);
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO nutrition_dataset (id, version, sha256, food_count, portion_count, loaded_at)
         VALUES (2, 'v', ?, 0, 0, 'now')`,
      )
        .bind('a'.repeat(64))
        .run(),
    ).rejects.toThrow(/CHECK/iu);
  });
});

describe('recipe link migration', () => {
  beforeEach(applyMigrations);

  const seedHousehold = async (): Promise<string> => {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at)
       VALUES (?, 'Link Family', ?, ?)`,
    )
      .bind(id, now, now)
      .run();
    return id;
  };

  const setLink = (recipeId: string, value: unknown) =>
    testEnv.DB.prepare('UPDATE recipes SET link_url = ? WHERE id = ?')
      .bind(value, recipeId)
      .run();

  it('applies 0007 on top of the existing schema, adding only a nullable link column to recipes', async () => {
    const columns = await testEnv.DB.prepare(
      'SELECT name, "notnull", dflt_value FROM pragma_table_info(\'recipes\')',
    ).all<{ name: string; notnull: number; dflt_value: unknown }>();
    expect(columns.results.at(-1)).toEqual({
      name: 'link_url',
      notnull: 0,
      dflt_value: null,
    });

    // An existing recipe keeps no link.
    const householdId = await seedHousehold();
    const recipeId = await seedRecipe(householdId, 'Soup');
    const row = await testEnv.DB.prepare(
      'SELECT link_url FROM recipes WHERE id = ?',
    )
      .bind(recipeId)
      .first<{ link_url: string | null }>();
    expect(row?.link_url).toBeNull();
  });

  it('accepts only an https link of up to 2,048 characters on a manual recipe', async () => {
    const householdId = await seedHousehold();
    const recipeId = await seedRecipe(householdId, 'Soup');
    for (const valid of [
      'https://www.kikkoman.com.sg/product_recipes/soup/',
      `https://example.com/${'a'.repeat(2048 - 20)}`,
      null,
    ]) {
      await setLink(recipeId, valid);
    }
    for (const invalid of [
      'http://example.com/a',
      'javascript:alert(1)',
      'https://',
      '',
      `https://example.com/${'a'.repeat(2048 - 19)}`,
    ]) {
      await expect(setLink(recipeId, invalid), invalid).rejects.toThrow(
        /CHECK/iu,
      );
    }
  });

  it('rejects a link on a website-sourced recipe', async () => {
    const householdId = await seedHousehold();
    const now = new Date().toISOString();
    const recipeId = crypto.randomUUID();
    await testEnv.DB.prepare(
      `INSERT INTO recipes (
         id, household_id, title, version, write_token, source_kind,
         source_submitted_url, source_host, source_imported_at,
         created_at, updated_at
       ) VALUES (?, ?, 'Imported', 1, ?, 'website', ?, ?, ?, ?, ?)`,
    )
      .bind(
        recipeId,
        householdId,
        crypto.randomUUID(),
        'https://budgetbytes.com/a',
        'budgetbytes.com',
        now,
        now,
        now,
      )
      .run();
    await expect(setLink(recipeId, 'https://example.com/a')).rejects.toThrow(
      /CHECK/iu,
    );
    await setLink(recipeId, null);
  });

  it('deletes the link with its recipe and its household', async () => {
    const householdId = await seedHousehold();
    const recipeId = await seedRecipe(householdId, 'Soup');
    await setLink(recipeId, 'https://example.com/soup');
    await testEnv.DB.prepare('DELETE FROM households WHERE id = ?')
      .bind(householdId)
      .run();
    const count = await testEnv.DB.prepare(
      'SELECT COUNT(*) AS n FROM recipes WHERE link_url IS NOT NULL',
    ).first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});
