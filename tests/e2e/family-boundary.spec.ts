import { expect, test } from '@playwright/test';

// The layout owns one result region for session and member outcomes; routed
// sections such as the pantry have their own. Target the layout's notice
// directly so assertions stay unambiguous.

test('local owner can bootstrap and invite a family member', async ({
  page,
}) => {
  await page.goto('/family');

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

  // Unique per run so a retry or a parallel worker never collides on the
  // address, which would surface as a confusing duplicate-membership error.
  const invitedEmail = `e2e-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const emailField = page.getByLabel('Verified email address');
  const addButton = page.getByRole('button', { name: 'Add member' });

  // The form stays disabled while the bootstrap mutation settles. Submitting
  // before it is ready sends an empty email, which only sets a field error and
  // leaves the result notice reading "Your family space is ready." — the exact
  // flake that failed a production deployment run.
  await expect(addButton).toBeEnabled();
  await emailField.fill(invitedEmail);
  await expect(emailField).toHaveValue(invitedEmail);
  await addButton.click();

  // Assert the durable row first, then the transient notice.
  const invitedRow = page.getByRole('row', { name: new RegExp(invitedEmail) });
  await expect(invitedRow).toContainText(invitedEmail);
  await expect(page.locator('output.notice')).toContainText(
    `${invitedEmail} is invited`,
  );

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
  await expect(page.locator('output.notice')).toContainText(
    'Member was removed.',
  );
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

  await page.goto('/family');

  await expect(
    page.locator('.panel').getByText('The test family'),
  ).toBeVisible();
  await expect(page.getByText('Family member', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Members' })).toHaveCount(0);
  await expect(page.getByLabel('Family access')).toContainText(
    'Private by default',
  );
});

test('adapts member information and actions to the panel without horizontal scrolling', async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name === 'chromium-mobile';
  await page.setViewportSize({
    width: isMobile ? 390 : 1100,
    height: 800,
  });
  await page.route('**/api/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        member: {
          id: 'owner-1',
          email: 'owner@example.test',
          role: 'owner',
        },
        household: { id: 'household-1', name: 'The test family' },
      }),
    });
  });
  await page.route('**/api/household/members', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        members: [
          {
            id: 'owner-1',
            email: 'owner@example.test',
            role: 'owner',
            status: 'active',
          },
          {
            id: 'member-1',
            email: 'member-with-a-long-address@example.test',
            role: 'member',
            status: 'active',
          },
        ],
      }),
    });
  });

  await page.goto('/family');

  const tableViewport = page.locator('.member-table-wrap');
  const memberRow = page.getByRole('row', {
    name: /member-with-a-long-address@example\.test/i,
  });
  await expect(memberRow).toContainText('member');
  await expect(memberRow).toContainText('active');
  const revokeButton = memberRow.getByRole('button', { name: 'Revoke' });
  await expect(revokeButton).toBeVisible();

  const tableViewportBox = await tableViewport.boundingBox();
  const tableBox = await tableViewport.locator('table').boundingBox();
  const rowBox = await memberRow.boundingBox();
  const memberCellBox = await memberRow.locator('td').first().boundingBox();
  const roleCellBox = await memberRow.locator('td').nth(1).boundingBox();
  const statusCellBox = await memberRow.locator('td').nth(2).boundingBox();
  const actionsCellBox = await memberRow
    .locator('.member-actions-cell')
    .boundingBox();
  expect(tableViewportBox).not.toBeNull();
  expect(tableBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  expect(memberCellBox).not.toBeNull();
  expect(roleCellBox).not.toBeNull();
  expect(statusCellBox).not.toBeNull();
  expect(actionsCellBox).not.toBeNull();
  expect(tableBox!.x).toBeGreaterThanOrEqual(tableViewportBox!.x);
  expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(
    tableViewportBox!.x + tableViewportBox!.width + 1,
  );
  expect(roleCellBox!.x + roleCellBox!.width).toBeLessThanOrEqual(
    statusCellBox!.x + 1,
  );
  // The actions cell stays inside the table rather than overflowing it,
  // whether the row lays out in columns or stacks at phone width.
  expect(actionsCellBox!.x).toBeGreaterThanOrEqual(tableViewportBox!.x - 1);
  expect(actionsCellBox!.x + actionsCellBox!.width).toBeLessThanOrEqual(
    tableViewportBox!.x + tableViewportBox!.width + 1,
  );
  // Vertical position is not asserted: the row legitimately lays out in
  // columns on a wide panel and stacks at phone width, and sub-pixel borders
  // make an exact comparison meaningless. Horizontal fit is the property this
  // test exists for.
  expect(actionsCellBox!.height).toBeGreaterThan(0);
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
  await page.goto('/family');

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
