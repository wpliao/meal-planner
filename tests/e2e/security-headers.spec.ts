import { expect, test } from '@playwright/test';

// These run against `vite preview`, which serves the production build through
// the real Cloudflare asset pipeline. The `vite dev` server used by the other
// suites bypasses that pipeline and never applies `public/_headers`.

const expectedHeaders: Record<string, string> = {
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy':
    "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'",
};

test('serves the application document with the static security headers', async ({
  request,
}) => {
  const response = await request.get('/');

  expect(response.status()).toBe(200);
  const headers = response.headers();
  for (const [name, value] of Object.entries(expectedHeaders)) {
    expect(headers[name], `expected ${name}`).toBe(value);
  }
});

test('serves built assets with the same framing protection', async ({
  request,
}) => {
  const document = await (await request.get('/')).text();
  const scriptPath = /src="(\/assets\/[^"]+\.js)"/u.exec(document)?.[1];
  expect(scriptPath, 'built script path').toBeTruthy();

  const asset = await request.get(scriptPath as string);

  expect(asset.status()).toBe(200);
  expect(asset.headers()['x-frame-options']).toBe('DENY');
});

test('does not serve the headers configuration file itself', async ({
  request,
}) => {
  const response = await request.get('/_headers');

  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain('frame-ancestors');
});
