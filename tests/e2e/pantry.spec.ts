import { expect, test, type Page } from '@playwright/test';

// Each Playwright project gets its own local D1, but specs inside a project
// share it. Bootstrap only when this run still needs it, and use unique item
// names so specs never collide.
const openFamilySpace = async (page: Page) => {
  await page.goto('/pantry');

  const setup = page.getByRole('heading', { name: 'Set up your family space' });
  if (await setup.isVisible().catch(() => false)) {
    await page.getByLabel('Family space name').fill('E2E Family');
    await page.getByRole('button', { name: 'Create family space' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create family space' })
      .click();
  }

  await expect(page.getByRole('heading', { name: 'Pantry' })).toBeVisible();
};

// The members panel has its own live region, so scope to the pantry panel.
const pantryStatus = (page: Page) =>
  page.getByRole('complementary', { name: 'Pantry' }).getByRole('status');

const uniqueName = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

// The add form is disabled while the previous mutation settles. Submitting
// before it is ready sends an empty name, which only sets a field error and
// leaves the previous notice in place — a silent no-op that reads as a hang.
const submitItem = async (page: Page, name: string, signal?: string) => {
  const field = page.getByLabel('Item name');
  const button = page.getByRole('button', { name: 'Add item' });

  await expect(button).toBeEnabled();
  await field.fill(name);
  await expect(field).toHaveValue(name);
  if (signal) await page.getByLabel(signal, { exact: true }).check();
  await button.click();
};

const addItem = async (page: Page, name: string, signal: string) => {
  await submitItem(page, name, signal);
  await expect(pantryStatus(page)).toContainText(
    `${name} was added to the pantry.`,
  );
};

const itemCard = (page: Page, name: string) =>
  page.locator('.pantry-item').filter({ hasText: name });

/** Rename and Remove live behind the per-item actions menu. */
const itemAction = async (page: Page, name: string, action: string) => {
  await itemCard(page, name)
    .getByRole('button', { name: `Actions for ${name}` })
    .click();
  await page.getByRole('menuitem', { name: action }).click();
};

test('an item moves through Needed, Shopping, and Available', async ({
  page,
}) => {
  await openFamilySpace(page);
  const name = uniqueName('milk');

  await addItem(page, name, 'Needed');

  // Needed items belong to the shopping view.
  await page.getByRole('button', { name: /^Shopping/u }).click();
  await expect(itemCard(page, name)).toBeVisible();

  // Buying it and marking Available takes it off the list.
  const signals = itemCard(page, name).getByRole('group', {
    name: `Status for ${name}`,
  });
  await signals.getByRole('button', { name: 'Available' }).click();
  await expect(pantryStatus(page)).toContainText(
    `${name} is now marked Available.`,
  );
  await expect(itemCard(page, name)).toHaveCount(0);

  await page.getByRole('button', { name: /^All items/u }).click();
  await expect(itemCard(page, name)).toBeVisible();
});

test('a duplicate name is refused without creating a second item', async ({
  page,
}) => {
  await openFamilySpace(page);
  const name = uniqueName('rice');

  await addItem(page, name, 'Available');

  await submitItem(page, name.toUpperCase());

  await expect(pantryStatus(page)).toContainText('already in your pantry');
  await expect(itemCard(page, name)).toHaveCount(1);
});

test('an item can be renamed and removed with confirmation', async ({
  page,
}) => {
  await openFamilySpace(page);
  const name = uniqueName('beans');
  const renamed = `${name}-renamed`;

  await addItem(page, name, 'Low');

  await itemAction(page, name, 'Rename');
  // The card no longer contains the old name once the input replaces it.
  await page.getByLabel('New name').fill(renamed);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(pantryStatus(page)).toContainText(
    `The item was renamed to ${renamed}.`,
  );

  // Escape dismisses the confirmation without deleting.
  await itemAction(page, renamed, 'Remove');
  await expect(page.getByRole('dialog')).toContainText(`Remove ${renamed}?`);
  await page.getByRole('dialog').press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(itemCard(page, renamed)).toBeVisible();

  await itemAction(page, renamed, 'Remove');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove item' })
    .click();
  await expect(pantryStatus(page)).toContainText(
    `${renamed} was removed from the pantry.`,
  );
  await expect(itemCard(page, renamed)).toHaveCount(0);
});

test('pantry names and actions fit the panel without sideways scrolling', async ({
  page,
}, testInfo) => {
  const isMobile = testInfo.project.name === 'chromium-mobile';
  await page.setViewportSize({ width: isMobile ? 390 : 1100, height: 800 });

  await openFamilySpace(page);
  const name = uniqueName('a-very-long-pantry-item-name-for-layout');

  await addItem(page, name, 'Low');

  const card = itemCard(page, name);
  await expect(
    card.getByRole('button', { name: `Actions for ${name}` }),
  ).toBeVisible();

  const panelBox = await page.locator('.card').first().boundingBox();
  const cardBox = await card.boundingBox();
  const actionsBox = await card.locator('.pantry-item__signals').boundingBox();
  expect(panelBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();

  // The item and its actions stay inside the pantry panel at both widths.
  expect(cardBox!.x).toBeGreaterThanOrEqual(panelBox!.x - 1);
  expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(
    panelBox!.x + panelBox!.width + 1,
  );
  expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(
    cardBox!.x + cardBox!.width + 1,
  );
});

test('signal controls and the rename field are usably sized', async ({
  page,
}) => {
  await openFamilySpace(page);
  const name = uniqueName('quinoa');
  await addItem(page, name, 'Low');

  // Safari sizes unconstrained form controls differently from Chromium, so
  // assert real geometry rather than trusting that the control is present.
  const radios = page.locator('.pantry-signals input[type="radio"]');
  await expect(radios).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const box = await radios.nth(index).boundingBox();
    expect(box, `radio ${index} box`).not.toBeNull();
    expect(box!.width).toBeGreaterThan(10);
    expect(box!.width).toBeLessThan(40);
    expect(box!.height).toBeGreaterThan(10);
    expect(box!.height).toBeLessThan(40);
  }

  // Each signal label must stay clear of the next one.
  const labels = page.locator('.pantry-signals label');
  const boxes = [];
  for (let index = 0; index < (await labels.count()); index += 1) {
    boxes.push(await labels.nth(index).boundingBox());
  }
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const overlap =
        boxes[a]!.x < boxes[b]!.x + boxes[b]!.width &&
        boxes[b]!.x < boxes[a]!.x + boxes[a]!.width &&
        boxes[a]!.y < boxes[b]!.y + boxes[b]!.height &&
        boxes[b]!.y < boxes[a]!.y + boxes[a]!.height;
      expect(overlap, `labels ${a} and ${b} overlap`).toBe(false);
    }
  }

  // The rename field must be wide enough to read what you are typing.
  await itemAction(page, name, 'Rename');
  const field = await page.getByLabel('New name').boundingBox();
  expect(field).not.toBeNull();
  expect(field!.width).toBeGreaterThan(120);
});

test('a non-member sees no pantry at all', async ({ page }) => {
  await page.route('**/api/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'not-a-member' }),
    });
  });

  await page.goto('/pantry');

  await expect(
    page.getByRole('heading', { name: 'You are not a family member' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pantry' })).toHaveCount(0);
});
