import { beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, testEnv } from './helpers';

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
