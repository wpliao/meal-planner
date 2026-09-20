import { expect, test } from '@playwright/test';

test('local owner can bootstrap and invite a family member', async ({
  page,
}) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', {
      name: 'Set up your family space',
    }),
  ).toBeVisible();

  await page.getByLabel('Family space name').fill('E2E Family');
  await page.getByRole('button', { name: 'Create family space' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Create “E2E Family”');
  await dialog.getByRole('button', { name: 'Create family space' }).click();

  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  const invitedEmail = 'e2e-invitee@example.test';
  await page.getByLabel('Verified email address').fill(invitedEmail);
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status')).toContainText(
    `${invitedEmail} is invited`,
  );
  const invitedRow = page.getByRole('row', { name: new RegExp(invitedEmail) });
  await expect(invitedRow).toContainText(invitedEmail);
  await invitedRow.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    `Remove ${invitedEmail}?`,
  );
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await invitedRow.getByRole('button', { name: 'Remove' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove member' })
    .click();
  await expect(page.getByRole('status')).toContainText('Member was removed.');
  await expect(invitedRow).toHaveCount(0);
});

test('active member sees only their family view', async ({ page }) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        member: {
          id: 'member-1',
          email: 'member@example.test',
          role: 'member',
        },
        household: { id: 'household-1', name: 'The test family' },
      }),
    });
  });

  await page.goto('/');

  await expect(page.getByText('The test family')).toBeVisible();
  await expect(page.getByText('Family member', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Members' })).toHaveCount(0);
  await expect(page.getByLabel('Family access')).toContainText(
    'Private by default',
  );
});

test('not-a-member and denied identities have no household management UI', async ({
  page,
}) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'not-a-member' }),
    });
  });
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'You are not a family member' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Members' })).toHaveCount(0);
  await expect(page.getByText('The test family')).toHaveCount(0);

  await page.unroute('**/api/session');
  await page.route('**/api/session', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'not_a_member', message: 'Access denied.' },
      }),
    });
  });
  await page.reload();

  await expect(
    page.getByRole('heading', { name: 'The family space is unavailable' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Members' })).toHaveCount(0);
});
