import { expect, test } from '@playwright/test';

test('loads the responsive application shell', async ({ page }) => {
  await page.goto('/');

  // This is the smoke test that the shell boots and routes; which section it
  // lands on depends on session state, which family-boundary.spec.ts covers
  // in each of its forms.
  //
  // It used to match the heading against the three not-yet-ready states. That
  // only held while no household existed. Once an earlier spec bootstraps one,
  // `/` resolves and redirects to `/pantry`, leaving those headings on screen
  // for as long as the session request takes — so the assertion was racing the
  // redirect, and passed on WebKit while failing on Chromium.
  const banner = page.getByRole('banner');
  await expect(banner).toBeVisible();
  // Scoped to the banner: the loading state's heading carries the same words.
  await expect(banner.getByText('Our family kitchen')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});

test('health endpoint is available through the integrated application', async ({
  request,
}) => {
  const response = await request.get('/api/health');

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    status: 'ok',
    environment: 'local',
  });
});
