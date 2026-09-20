import { expect, test } from '@playwright/test';

test('loads the responsive application shell', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', {
      name: /Our family kitchen|Set up your family space|The family space is unavailable/,
    }),
  ).toBeVisible();
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
