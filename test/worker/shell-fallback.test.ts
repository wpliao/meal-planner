import { beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, bootstrapOwner, fetchWorker } from './helpers';

/**
 * The client router needs the Worker to answer application paths with the
 * shell. These tests guard the half that matters for security: that adding
 * that branch did not open a way around the API boundary.
 *
 * The shell itself is served by the asset pipeline, which this runtime does
 * not provide, so `tests/e2e/shell-fallback.spec.ts` covers the response body
 * against a real build.
 */
describe('application shell fallback', () => {
  beforeEach(async () => {
    await applyMigrations();
    await bootstrapOwner();
  });

  it('still answers an unknown API path with a JSON 404', async () => {
    for (const path of [
      '/api',
      '/api/',
      '/api/unknown',
      '/api/pantry',
      '/api/household',
      '/api/household/members/not-a-uuid',
    ]) {
      const response = await fetchWorker(
        new Request(`https://example.test${path}`),
      );
      expect(response.status, path).toBe(404);
      expect(response.headers.get('content-type'), path).toContain(
        'application/json',
      );
      await expect(response.json(), path).resolves.toMatchObject({
        error: { code: 'not_found' },
      });
    }
  });

  it('never serves the shell in place of an API response', async () => {
    // A path that merely looks like an application route but sits under /api
    // must not fall through, or an unauthenticated caller could receive a
    // 200 where the boundary intends an error.
    const response = await fetchWorker(
      new Request('https://example.test/api/pantry/items/../../pantry'),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('<!doctype html');
  });

  it('answers a write to an application path with 404, not the shell', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE', 'PUT'] as const) {
      const response = await fetchWorker(
        new Request('https://example.test/pantry', {
          method,
          headers: {
            'content-type': 'application/json',
            origin: 'https://example.test',
          },
        }),
      );
      expect(response.status, method).toBe(404);
      await expect(response.json(), method).resolves.toMatchObject({
        error: { code: 'not_found' },
      });
    }
  });

  it('keeps the health endpoint and the API routes working', async () => {
    const health = await fetchWorker(
      new Request('https://example.test/api/health'),
    );
    expect(health.status).toBe(200);

    const session = await fetchWorker(
      new Request('https://example.test/api/session'),
    );
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({ status: 'ready' });
  });
});
