import { expect, test } from '@playwright/test';

test('loads the responsive foundation and reaches the Worker', async ({
  page,
}) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Good meals start with a simple plan.' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Kitchen service ready · local',
  );
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
