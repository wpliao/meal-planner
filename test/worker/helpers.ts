import {
  applyD1Migrations,
  env,
  SELF,
  type D1Migration,
} from 'cloudflare:test';

type TestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };

export const testEnv = env as TestEnv;

export const applyMigrations = async (): Promise<void> => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.batch([
    testEnv.DB.prepare('DELETE FROM pantry_items'),
    testEnv.DB.prepare('DELETE FROM app_installation'),
    testEnv.DB.prepare('DELETE FROM household_members'),
    testEnv.DB.prepare('DELETE FROM households'),
  ]);
};

/**
 * Seeds a second household with one active member so isolation tests can prove
 * that a foreign ID never escapes the actor's household scope.
 */
export const seedOtherHousehold = async (): Promise<{
  householdId: string;
  memberId: string;
}> => {
  const now = new Date().toISOString();
  const householdId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO households (id, name, created_at, updated_at)
       VALUES (?, 'Other Family', ?, ?)`,
    ).bind(householdId, now, now),
    testEnv.DB.prepare(
      `INSERT INTO household_members (
         id, household_id, normalized_email, access_subject, role, status,
         invited_at, activated_at, revoked_at, created_at, updated_at
       ) VALUES (?, ?, 'other@example.test', ?, 'member', 'active', ?, ?, NULL, ?, ?)`,
    ).bind(memberId, householdId, 'other-subject', now, now, now, now),
  ]);
  return { householdId, memberId };
};

export const seedPantryItem = async (
  householdId: string,
  name: string,
  status: 'available' | 'low' | 'needed' = 'available',
): Promise<string> => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await testEnv.DB.prepare(
    `INSERT INTO pantry_items (
       id, household_id, display_name, normalized_name, status,
       version, created_source, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 1, 'manual', ?, ?)`,
  )
    .bind(id, householdId, name, name.toLowerCase(), status, now, now)
    .run();
  return id;
};

export const mutationInit = (
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'https://example.test',
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const bootstrapOwner = async (): Promise<Response> =>
  fetchWorker(
    new Request(
      'https://example.test/api/bootstrap',
      mutationInit('POST', { householdName: 'Liao Family' }),
    ),
  );

export const fetchWorker = (request: Request): Promise<Response> =>
  SELF.fetch(request);
