import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  parseJsonc,
  repositoryTargetFor,
  UUID,
} from '../../src/operations/household-decommission/config.ts';
import { WRANGLER_CONFIG_TEXT } from './fake-cloudflare';

const committed = parseJsonc(
  await readFile(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'),
);
const fixture = parseJsonc(WRANGLER_CONFIG_TEXT);

/**
 * The operations tests run against `WRANGLER_CONFIG_TEXT` so that the real
 * resource IDs never appear outside `wrangler.jsonc`. This test keeps that
 * fixture honest: the committed file must still declare the same named
 * environments, Worker names, and database names, with distinct UUID IDs.
 */
describe('committed wrangler.jsonc', () => {
  it.each(['development', 'production'])(
    'declares the %s environment the operations scripts expect',
    (environment) => {
      const real = repositoryTargetFor(committed, environment);
      const expected = repositoryTargetFor(fixture, environment);
      expect(real.workerName).toBe(expected.workerName);
      expect(real.databaseName).toBe(expected.databaseName);
      expect(real.databaseId).toMatch(UUID);
    },
  );

  it('gives development and production different databases', () => {
    const development = repositoryTargetFor(committed, 'development');
    const production = repositoryTargetFor(committed, 'production');
    expect(development.databaseId).not.toBe(production.databaseId);
    expect(development.databaseName).not.toBe(production.databaseName);
  });

  it('keeps the local identity adapter unpublishable', () => {
    expect(committed).toMatchObject({
      workers_dev: false,
      preview_urls: false,
    });
  });
});
