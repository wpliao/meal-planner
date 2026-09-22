import { readdir, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  confirmationFor,
  parseDecommissionConfig,
  parseJsonc,
  PRODUCTION_INELIGIBLE_MESSAGE,
  repositoryMigrations,
  repositoryTargetFor,
} from '../../src/operations/household-decommission/config.ts';
import {
  ACCESS_APP_ID,
  API_TOKEN,
  DEVELOPMENT_D1_ID,
  HOUSEHOLD_ID,
  MIGRATIONS,
  validInputs,
} from './fake-cloudflare';

const repositoryRoot = new URL('../../', import.meta.url);
const wranglerConfig = parseJsonc(
  await readFile(new URL('wrangler.jsonc', repositoryRoot), 'utf8'),
);

const parse = (inputs: Record<string, string | undefined>) =>
  parseDecommissionConfig({
    inputs,
    wranglerConfig,
    migrationFiles: MIGRATIONS,
  });

describe('decommission approval inputs', () => {
  it('accepts a complete development request that matches wrangler.jsonc', () => {
    expect(parse(validInputs())).toEqual({
      environment: 'development',
      householdId: HOUSEHOLD_ID,
      databaseId: DEVELOPMENT_D1_ID,
      databaseName: 'family-meal-planner-dev-d1',
      workerName: 'family-meal-planner-development',
      accessAppId: ACCESS_APP_ID,
      accountId: '0123456789abcdef0123456789abcdef',
      apiToken: API_TOKEN,
      approvalReference:
        'https://github.com/wpliao/meal-planner/issues/32#issuecomment-5790000001',
      expectedMigrations: MIGRATIONS,
    });
  });

  it('refuses production until rehearsal evidence and a separate approval exist', () => {
    expect(() =>
      parse(
        validInputs({
          DECOMMISSION_ENVIRONMENT: 'production',
          DECOMMISSION_CONFIRMATION: confirmationFor('production'),
          DECOMMISSION_EXPECTED_D1_DATABASE_ID:
            'd944b652-580f-437e-b7ce-21818525c46c',
        }),
      ),
    ).toThrow(PRODUCTION_INELIGIBLE_MESSAGE);
  });

  it.each([
    ['a missing environment', { DECOMMISSION_ENVIRONMENT: undefined }],
    ['an unknown environment', { DECOMMISSION_ENVIRONMENT: 'local' }],
    ['a branch other than main', { GITHUB_REF: 'refs/heads/feature' }],
    ['a missing branch', { GITHUB_REF: undefined }],
    ['a missing confirmation', { DECOMMISSION_CONFIRMATION: undefined }],
    [
      'the deploy confirmation',
      { DECOMMISSION_CONFIRMATION: 'DEPLOY_PRODUCTION' },
    ],
    [
      'a lowercase confirmation',
      { DECOMMISSION_CONFIRMATION: 'decommission_development_household' },
    ],
    [
      'the production confirmation',
      { DECOMMISSION_CONFIRMATION: 'DECOMMISSION_PRODUCTION_HOUSEHOLD' },
    ],
    ['a missing approval', { DECOMMISSION_APPROVAL_REFERENCE: undefined }],
    ['a blank approval', { DECOMMISSION_APPROVAL_REFERENCE: '   ' }],
    [
      'an approval in another repository',
      {
        DECOMMISSION_APPROVAL_REFERENCE:
          'https://github.com/someone/meal-planner/issues/32#issuecomment-1',
      },
    ],
    [
      'an issue link without a comment',
      {
        DECOMMISSION_APPROVAL_REFERENCE:
          'https://github.com/wpliao/meal-planner/issues/32',
      },
    ],
    [
      'a pull-request link',
      {
        DECOMMISSION_APPROVAL_REFERENCE:
          'https://github.com/wpliao/meal-planner/pull/32#issuecomment-1',
      },
    ],
    [
      'an approval with trailing content',
      {
        DECOMMISSION_APPROVAL_REFERENCE:
          'https://github.com/wpliao/meal-planner/issues/32#issuecomment-1?x=1',
      },
    ],
    ['a missing household', { DECOMMISSION_EXPECTED_HOUSEHOLD_ID: undefined }],
    [
      'a household ID that is not a UUID',
      { DECOMMISSION_EXPECTED_HOUSEHOLD_ID: "x' OR 1=1 --" },
    ],
    [
      'an uppercase household ID',
      { DECOMMISSION_EXPECTED_HOUSEHOLD_ID: HOUSEHOLD_ID.toUpperCase() },
    ],
    [
      'an invalid D1 ID',
      { DECOMMISSION_EXPECTED_D1_DATABASE_ID: 'family-meal-planner-dev-d1' },
    ],
    [
      'the production D1 ID for development',
      {
        DECOMMISSION_EXPECTED_D1_DATABASE_ID:
          'd944b652-580f-437e-b7ce-21818525c46c',
      },
    ],
    ['a missing Access application', { DECOMMISSION_ACCESS_APP_ID: undefined }],
    ['an invalid account ID', { CLOUDFLARE_ACCOUNT_ID: 'not-an-account' }],
    ['a missing token', { CLOUDFLARE_DECOMMISSION_API_TOKEN: undefined }],
  ])('refuses %s', (_, overrides) => {
    expect(() => parse(validInputs(overrides))).toThrow();
  });

  it('refuses when the repository has no committed migrations', () => {
    expect(() =>
      parseDecommissionConfig({
        inputs: validInputs(),
        wranglerConfig,
        migrationFiles: ['README.md'],
      }),
    ).toThrow('No committed migrations were found.');
  });

  it('never echoes the token in a validation error', () => {
    const run = () =>
      parse(validInputs({ DECOMMISSION_EXPECTED_HOUSEHOLD_ID: API_TOKEN }));
    expect(run).toThrow();
    try {
      run();
    } catch (error) {
      expect(String(error)).not.toContain(API_TOKEN);
    }
  });
});

describe('repository target', () => {
  it('reads the committed migrations in apply order and ignores other files', async () => {
    const files = await readdir(new URL('migrations/', repositoryRoot));
    const migrations = repositoryMigrations(files);
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations).toEqual(
      [...migrations].sort((a, b) => a.localeCompare(b, 'en')),
    );
    expect(migrations).not.toContain('README.md');
    expect(
      repositoryMigrations(['0002_b.sql', 'README.md', '0001_a.sql']),
    ).toEqual(['0001_a.sql', '0002_b.sql']);
  });

  it('reads each named environment from wrangler.jsonc', () => {
    expect(repositoryTargetFor(wranglerConfig, 'development')).toEqual({
      workerName: 'family-meal-planner-development',
      databaseName: 'family-meal-planner-dev-d1',
      databaseId: DEVELOPMENT_D1_ID,
    });
    expect(repositoryTargetFor(wranglerConfig, 'production')).toEqual({
      workerName: 'family-meal-planner-production',
      databaseName: 'family-meal-planner-prod-d1',
      databaseId: 'd944b652-580f-437e-b7ce-21818525c46c',
    });
  });

  it.each([
    ['no configuration', null],
    ['no environments', {}],
    ['no matching environment', { env: { staging: {} } }],
    [
      'no DB binding',
      { env: { development: { name: 'w', d1_databases: [] } } },
    ],
    [
      'two DB bindings',
      {
        env: {
          development: {
            name: 'w',
            d1_databases: [
              { binding: 'DB', database_name: 'a', database_id: 'x' },
              { binding: 'DB', database_name: 'b', database_id: 'y' },
            ],
          },
        },
      },
    ],
    [
      'a missing Worker name',
      {
        env: {
          development: {
            d1_databases: [
              { binding: 'DB', database_name: 'a', database_id: 'x' },
            ],
          },
        },
      },
    ],
    [
      'a non-string database ID',
      {
        env: {
          development: {
            name: 'w',
            d1_databases: [
              { binding: 'DB', database_name: 'a', database_id: 1 },
            ],
          },
        },
      },
    ],
  ])('refuses a configuration with %s', (_, config) => {
    expect(() => repositoryTargetFor(config, 'development')).toThrow();
  });
});

describe('JSONC parsing', () => {
  it('drops comments and trailing commas but keeps string contents', () => {
    const text = `{
      // line comment
      "url": "https://example.test/a//b", /* block */
      "text": "keeps ,} and /* this */",
      "escaped": "quote \\" // not a comment",
      "list": [1, 2,],
    }`;
    expect(parseJsonc(text)).toEqual({
      url: 'https://example.test/a//b',
      text: 'keeps ,} and /* this */',
      escaped: 'quote " // not a comment',
      list: [1, 2],
    });
  });

  it('treats an unterminated block comment as the end of input', () => {
    expect(parseJsonc('{"a": 1} /* open')).toEqual({ a: 1 });
    expect(parseJsonc('{"a": 1} // no newline')).toEqual({ a: 1 });
  });
});
