import { describe, expect, it, vi } from 'vitest';
import type { CloudflareClient } from './household-decommission/cloudflare-client';
import {
  buildNutritionFixture,
  ENTRY_COUNT,
  INGREDIENT_COUNT,
  MATCH_COUNT,
  RECIPE_COUNT,
  validateFixtureWeek,
} from './dev-nutrition-fixture';
import {
  parseFixtureConfig,
  runNutritionFixture,
} from './dev-nutrition-fixture-runner';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const WRANGLER = `{
  "env": { "development": {
    "name": "test-development",
    "d1_databases": [{
      "binding": "DB", "database_name": "test-dev-d1",
      "database_id": "00000000-0000-4000-8000-000000000001"
    }]
  }}
}`;
const INPUTS = {
  GITHUB_REF: 'refs/heads/main',
  NUTRITION_FIXTURE_ENVIRONMENT: 'development',
  NUTRITION_FIXTURE_MODE: 'seed',
  NUTRITION_FIXTURE_WEEK_START: '2026-11-02',
  NUTRITION_FIXTURE_CONFIRMATION: 'SEED_DEVELOPMENT_NUTRITION',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_API_TOKEN: 'fake-test-token',
};

describe('development nutrition fixture guardrails', () => {
  it('uses stable UUIDs, only synthetic titles, and two distinct weeks', () => {
    const first = buildNutritionFixture('2026-11-02');
    const second = buildNutritionFixture('2026-11-02');
    expect(first).toEqual(second);
    expect(first.stressWeek).toBe('2026-11-09');
    expect(
      first.recipes.every(({ title }) => title.startsWith('[DEV TEST]')),
    ).toBe(true);
    expect(
      first.entries.every(({ title }) => title.startsWith('[DEV TEST]')),
    ).toBe(true);
    expect(
      new Set([...first.recipes, ...first.entries].map(({ id }) => id)).size,
    ).toBe(178);
    expect(first.recipes[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('rejects a production target, wrong branch, wrong confirmation, and invalid week', () => {
    for (const changed of [
      { NUTRITION_FIXTURE_ENVIRONMENT: 'production' },
      { GITHUB_REF: 'refs/heads/feature' },
      { NUTRITION_FIXTURE_CONFIRMATION: 'yes' },
      { NUTRITION_FIXTURE_WEEK_START: '2026-11-03' },
      { NUTRITION_FIXTURE_WEEK_START: '2028-01-03' },
    ]) {
      expect(() =>
        parseFixtureConfig({ ...INPUTS, ...changed }, WRANGLER, NOW),
      ).toThrow();
    }
    expect(parseFixtureConfig(INPUTS, WRANGLER, NOW)).toMatchObject({
      mode: 'seed',
      databaseName: 'test-dev-d1',
      week: '2026-11-02',
    });
  });

  it('allows cleanup after the seed week has passed', () => {
    expect(() =>
      validateFixtureWeek('2026-11-02', new Date('2027-11-02'), false),
    ).not.toThrow();
    expect(
      parseFixtureConfig(
        {
          ...INPUTS,
          NUTRITION_FIXTURE_MODE: 'cleanup',
          NUTRITION_FIXTURE_CONFIRMATION: 'CLEAN_DEVELOPMENT_NUTRITION',
        },
        WRANGLER,
        NOW,
      ),
    ).toMatchObject({ mode: 'cleanup' });
  });

  it('refuses an occupied week and a cleanup that would orphan another entry', async () => {
    const executeD1Batch = vi.fn();
    let occupied = 1;
    let attached = 0;
    const client = {
      getD1Database: () =>
        Promise.resolve({
          uuid: '00000000-0000-4000-8000-000000000001',
          name: 'test-dev-d1',
        }),
      readD1: (_databaseId: string, statement: { sql: string }) => {
        if (statement.sql.includes('FROM app_installation')) {
          return Promise.resolve([{ household_id: 'test-household' }]);
        }
        if (statement.sql.includes('AS owners'))
          return Promise.resolve([{ owners: 1 }]);
        if (
          statement.sql.includes('AS recipes,') &&
          statement.sql.includes('household_id <>')
        ) {
          return Promise.resolve([{ recipes: 0, entries: 0 }]);
        }
        if (statement.sql.includes('AS lines,')) {
          return Promise.resolve([
            { recipes: 0, lines: 0, matches: 0, entries: 0 },
          ]);
        }
        if (statement.sql.includes('AS occupied')) {
          return Promise.resolve([
            { recipes: 0, entries: 0, occupied, foods: 2, dataset: 1 },
          ]);
        }
        if (statement.sql.includes('id NOT IN'))
          return Promise.resolve([{ entries: attached }]);
        throw new Error('Unexpected test query');
      },
      executeD1Batch,
    } as unknown as CloudflareClient;
    const dependencies = { client, log: vi.fn(), now: () => NOW };
    await expect(
      runNutritionFixture(
        parseFixtureConfig(INPUTS, WRANGLER, NOW),
        dependencies,
      ),
    ).rejects.toThrow('target week already has plan entries');
    expect(executeD1Batch).not.toHaveBeenCalled();

    occupied = 0;
    attached = 1;
    await expect(
      runNutritionFixture(
        parseFixtureConfig(
          {
            ...INPUTS,
            NUTRITION_FIXTURE_MODE: 'cleanup',
            NUTRITION_FIXTURE_CONFIRMATION: 'CLEAN_DEVELOPMENT_NUTRITION',
          },
          WRANGLER,
          NOW,
        ),
        dependencies,
      ),
    ).rejects.toThrow('non-fixture plan entry');
    expect(executeD1Batch).not.toHaveBeenCalled();
  });

  it('seeds, verifies, and then cleans the same fixture without touching other rows', async () => {
    let seeded = false;
    let seedStages = 0;
    let cleanupStages = 0;
    const log = vi.fn();
    const readD1 = vi.fn((_databaseId: string, statement: { sql: string }) => {
      if (statement.sql.includes('FROM app_installation')) {
        return Promise.resolve([{ household_id: 'test-household' }]);
      }
      if (statement.sql.includes('AS owners'))
        return Promise.resolve([{ owners: 1 }]);
      if (statement.sql.includes('household_id <>')) {
        return Promise.resolve([{ recipes: 0, entries: 0 }]);
      }
      if (statement.sql.includes('AS lines,')) {
        return Promise.resolve([
          seeded
            ? {
                recipes: RECIPE_COUNT,
                lines: INGREDIENT_COUNT,
                matches: MATCH_COUNT,
                entries: ENTRY_COUNT,
              }
            : { recipes: 0, lines: 0, matches: 0, entries: 0 },
        ]);
      }
      if (statement.sql.includes('AS occupied')) {
        return Promise.resolve([
          { recipes: 7, entries: 9, occupied: 0, foods: 2, dataset: 1 },
        ]);
      }
      if (statement.sql.includes('id NOT IN'))
        return Promise.resolve([{ entries: 0 }]);
      throw new Error('Unexpected test query');
    });
    const executeD1Batch = vi.fn(
      (_databaseId: string, statements: readonly { sql: string }[]) => {
        if (statements[0].sql.startsWith('INSERT')) {
          seedStages += 1;
          if (seedStages === 4) seeded = true;
        } else {
          cleanupStages += 1;
          if (cleanupStages === 2) seeded = false;
        }
        return Promise.resolve([{ success: true, changes: 1, rows: [] }]);
      },
    );
    const client = {
      getD1Database: () =>
        Promise.resolve({
          uuid: '00000000-0000-4000-8000-000000000001',
          name: 'test-dev-d1',
        }),
      readD1,
      executeD1Batch,
    } as unknown as CloudflareClient;
    const dependencies = { client, log, now: () => NOW };
    await runNutritionFixture(
      parseFixtureConfig(INPUTS, WRANGLER, NOW),
      dependencies,
    );
    expect(seedStages).toBe(4);
    expect(seeded).toBe(true);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"status":"seeded"'),
    );

    await runNutritionFixture(
      parseFixtureConfig(
        {
          ...INPUTS,
          NUTRITION_FIXTURE_MODE: 'cleanup',
          NUTRITION_FIXTURE_CONFIRMATION: 'CLEAN_DEVELOPMENT_NUTRITION',
        },
        WRANGLER,
        NOW,
      ),
      dependencies,
    );
    expect(cleanupStages).toBe(2);
    expect(seeded).toBe(false);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"status":"cleaned"'),
    );
    expect(executeD1Batch).toHaveBeenCalledTimes(6);
  });
});
