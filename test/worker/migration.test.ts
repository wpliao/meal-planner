import { beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, seedPantryItem, testEnv } from './helpers';

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
