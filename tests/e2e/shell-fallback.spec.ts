import { expect, test } from '@playwright/test';

/**
 * Runs against `vite preview`, which serves the production build through the
 * real Cloudflare asset pipeline — the only place the Worker's ASSETS binding
 * is backed by actual files. The Worker-runtime suite covers the boundary
 * assertions; this covers what is actually returned.
 */

test('an application path returns the shell so a deep link resolves', async ({
  request,
}) => {
  const response = await request.get('/pantry');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');

  const body = await response.text();
  expect(body).toContain('<div id="root">');
  // The shell is the same document as the root, carrying no household data.
  expect(body).not.toContain('household');
  expect(body).not.toContain('@example.test');
});

test('a nested application path returns the shell too', async ({ request }) => {
  const response = await request.get('/family/members/anything');

  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('<div id="root">');
});

test('the shell keeps its security headers on an application path', async ({
  request,
}) => {
  const response = await request.get('/pantry');
  const headers = response.headers();

  // public/_headers must still apply when the Worker hands the request back
  // to the asset pipeline, or deep links would be framable while "/" is not.
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['content-security-policy']).toContain(
    "frame-ancestors 'none'",
  );
  expect(headers['referrer-policy']).toBe('no-referrer');
});

test('an unknown API path is still a JSON 404, not the shell', async ({
  request,
}) => {
  const response = await request.get('/api/unknown');

  expect(response.status()).toBe(404);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
});

test('a write to an application path is refused rather than served', async ({
  request,
}) => {
  const response = await request.post('/pantry', {
    headers: { 'content-type': 'application/json' },
    data: {},
  });

  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain('<div id="root">');
});
