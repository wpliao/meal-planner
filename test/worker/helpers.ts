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
    testEnv.DB.prepare('DELETE FROM app_installation'),
    testEnv.DB.prepare('DELETE FROM household_members'),
    testEnv.DB.prepare('DELETE FROM households'),
  ]);
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
