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

test('balances member information and actions without horizontal scrolling', async ({
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

  await page.goto('/');

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
  const actionsCellBox = await memberRow
    .locator('.member-actions-cell')
    .boundingBox();
  expect(tableViewportBox).not.toBeNull();
  expect(tableBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  expect(memberCellBox).not.toBeNull();
  expect(actionsCellBox).not.toBeNull();
  expect(tableBox!.x).toBeGreaterThanOrEqual(tableViewportBox!.x);
  expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(
    tableViewportBox!.x + tableViewportBox!.width + 1,
  );
  if (isMobile) {
    expect(actionsCellBox!.y).toBeGreaterThan(memberCellBox!.y);
    expect(Math.abs(memberCellBox!.x - actionsCellBox!.x)).toBeLessThanOrEqual(
      1,
    );
    expect(
      Math.abs(memberCellBox!.width - actionsCellBox!.width),
    ).toBeLessThanOrEqual(1);
  } else {
    expect(actionsCellBox!.width).toBeLessThanOrEqual(rowBox!.width * 0.31);
    expect(memberCellBox!.width).toBeGreaterThan(actionsCellBox!.width);
  }
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
