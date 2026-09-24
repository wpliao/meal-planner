import { expect, test, type Page } from '@playwright/test';
import { openedDialog } from './dialog';

// The layout owns one result region for session and member outcomes; routed
// sections such as the pantry have their own. Target the layout's notice
// directly so assertions stay unambiguous.

/** Both mocked journeys stub the same session shape, varying only the role. */
const stubSession = (page: Page, role: 'owner' | 'member') =>
  page.route('**/api/session', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        member: {
          id: `${role}-1`,
          email: `${role}@example.test`,
          role,
        },
        household: { id: 'household-1', name: 'The test family' },
      }),
    }),
  );

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
  const dialog = await openedDialog(page);
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
  await expect(page.getByTestId('result')).toContainText(
    `${invitedEmail} is invited`,
  );

  await invitedRow.getByRole('button', { name: 'Remove' }).click();
  const removal = await openedDialog(page);
  await expect(removal).toContainText(`Remove ${invitedEmail}?`);
  await removal.press('Escape');
  await expect(removal).toBeHidden();

  await invitedRow.getByRole('button', { name: 'Remove' }).click();
  const confirmation = await openedDialog(page);
  await confirmation.getByRole('button', { name: 'Remove member' }).click();
  await expect(page.getByTestId('result')).toContainText('Member was removed.');
  await expect(invitedRow).toHaveCount(0);
});

test('successor confirms owner access before the first owner steps down', async ({
  page,
}) => {
  let signedInAs: 'owner' | 'successor' = 'owner';
  const members = [
    {
      id: 'owner-1',
      email: 'owner@example.test',
      role: 'owner',
      status: 'active',
    },
    {
      id: 'successor-1',
      email: 'successor@example.test',
      role: 'member',
      status: 'active',
    },
  ];
  await page.route('**/api/session', (route) => {
    const member = members[signedInAs === 'owner' ? 0 : 1];
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ready',
        member: { id: member.id, email: member.email, role: member.role },
        household: { id: 'household-1', name: 'The test family' },
      }),
    });
  });
  await page.route('**/api/household/members', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ members }),
    }),
  );
  await page.route('**/api/household/members/*', (route) => {
    const id = route.request().url().split('/').pop();
    const member = members.find((candidate) => candidate.id === id);
    const update = route.request().postDataJSON() as unknown as {
      role: 'owner' | 'member';
    };
    if (!member || route.request().method() !== 'PATCH') {
      return route.fulfill({ status: 404 });
    }
    member.role = update.role;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ member }),
    });
  });

  await page.goto('/family');
  await expect(page.getByText('To transfer ownership,')).toBeVisible();
  const successorRow = page.getByRole('row', {
    name: /successor@example\.test/i,
  });
  await successorRow.getByRole('button', { name: 'Make owner' }).click();
  await expect(successorRow).toContainText('owner');

  signedInAs = 'successor';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await expect(page.getByText('Family owner', { exact: true })).toBeVisible();

  signedInAs = 'owner';
  await page.reload();
  const ownerRow = page.getByRole('row', { name: /owner@example\.test/i });
  await ownerRow.getByRole('button', { name: 'Make member' }).click();
  const demotion = await openedDialog(page);
  await expect(demotion).toContainText(
    'First confirm another active owner has signed in',
  );
  await demotion.getByRole('button', { name: 'Make member' }).click();
  await expect(page.getByText('Family member', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Members' })).toHaveCount(0);
});

test('active member sees only their family view', async ({ page }) => {
  await stubSession(page, 'member');

  await page.goto('/family');

  await expect(
    page.getByTestId('family-panel').getByText('The test family'),
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
  await stubSession(page, 'owner');
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

  const tableViewport = page.getByTestId('member-table');
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
    .getByTestId('member-actions')
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
