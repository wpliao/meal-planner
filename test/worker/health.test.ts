import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Worker API', () => {
  it('returns a typed health response from the Workers runtime', async () => {
    const response = await SELF.fetch('https://example.test/api/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      environment: 'local',
      service: 'family-meal-planner',
    });
  });

  it('provides isolated local D1 and R2 bindings', async () => {
    const databaseResult = await env.DB.prepare('SELECT 1 AS value').first<{
      value: number;
    }>();

    expect(databaseResult?.value).toBe(1);
    expect(env.UPLOADS).toBeDefined();
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const response = await SELF.fetch('https://example.test/api/unknown');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'not_found', message: 'Not found.' },
    });
  });
});
