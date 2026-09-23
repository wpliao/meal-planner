import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

// Each Playwright project gets its own local D1, but specs inside a project
// share it. Bootstrap only when this run still needs it, and give every
// recipe a unique title so specs never collide.
const openRecipes = async (page: Page) => {
  await page.goto('/recipes');

  const setup = page.getByRole('heading', { name: 'Set up your family space' });
  if (await setup.isVisible().catch(() => false)) {
    await page.getByLabel('Family space name').fill('E2E Family');
    await page.getByRole('button', { name: 'Create family space' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create family space' })
      .click();
  }

  await expect(
    page.getByRole('heading', { level: 1, name: 'Recipes' }),
  ).toBeVisible();
};

const unique = (prefix: string) =>
  `${prefix} ${Math.random().toString(36).slice(2, 8)}`;

const panel = (page: Page) => page.getByTestId('recipe-panel');
const status = (page: Page) => page.getByTestId('recipe-result');
const field = (page: Page, name: string) =>
  page.getByRole('textbox', { name, exact: true });

/** Fills a field and waits for React to hold the value before moving on. */
const fill = async (page: Page, name: string, value: string) => {
  const target = field(page, name);
  await target.fill(value);
  await expect(target).toHaveValue(value);
};

interface RecipeBody {
  title: string;
  ingredients: string[];
  steps: string[];
  notes?: string | null;
}

interface SavedRecipe extends RecipeBody {
  id: string;
  version: number;
}

/** A same-origin JSON mutation, as the Worker requires. */
const mutate = async (
  request: APIRequestContext,
  testInfo: TestInfo,
  method: 'POST' | 'PATCH',
  path: string,
  data: unknown,
): Promise<SavedRecipe> => {
  const origin = String(testInfo.project.use.baseURL);
  const response = await request.fetch(path, {
    method,
    data,
    headers: { origin, 'content-type': 'application/json' },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { recipe: SavedRecipe }).recipe;
};

const createRecipe = (page: Page, testInfo: TestInfo, body: RecipeBody) =>
  mutate(page.request, testInfo, 'POST', '/api/recipes', body);

test('a member creates, views, edits, and deletes a recipe', async ({
  page,
}) => {
  await openRecipes(page);
  const title = unique('Soy chicken');

  await page.getByRole('link', { name: 'Add recipe' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'New recipe' }),
  ).toBeVisible();
  await fill(page, 'Title', title);
  await fill(page, 'Ingredient 1', '2 tbsp soy sauce');
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await fill(page, 'Ingredient 2', '500 g chicken thighs');
  await fill(page, 'Step 1', 'Marinate the chicken.');
  await page.getByRole('button', { name: 'Add step' }).click();
  await fill(page, 'Step 2', 'Grill until cooked through.');
  await fill(page, 'Notes', 'Family favourite.');
  await page.getByRole('button', { name: 'Save recipe' }).click();

  await expect(status(page)).toContainText(
    `“${title}” was saved to the family recipes.`,
  );
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();
  await expect(
    page.getByTestId('recipe-ingredients').getByRole('listitem'),
  ).toHaveText(['2 tbsp soy sauce', '500 g chicken thighs']);
  await expect(
    page.getByTestId('recipe-steps').getByRole('listitem'),
  ).toHaveText(['Marinate the chicken.', 'Grill until cooked through.']);
  await expect(page.getByTestId('recipe-notes')).toHaveText(
    'Family favourite.',
  );

  // The library lists it with its source.
  await page.getByRole('link', { name: /All recipes/u }).click();
  const item = page.getByTestId('recipe-item').filter({ hasText: title });
  await expect(item).toContainText('Manual');
  await item.getByRole('link', { name: title }).click();

  const renamed = `${title} thighs`;
  await page.getByRole('link', { name: 'Edit recipe' }).click();
  await fill(page, 'Title', renamed);
  await page.getByRole('button', { name: 'Remove step 1' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(status(page)).toContainText('Your changes were saved.');
  await expect(
    page.getByRole('heading', { level: 1, name: renamed }),
  ).toBeVisible();
  await expect(
    page.getByTestId('recipe-steps').getByRole('listitem'),
  ).toHaveText(['Grill until cooked through.']);

  // Escape dismisses the confirmation without deleting.
  const trigger = page.getByRole('button', { name: 'Delete recipe' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Delete “${renamed}”?`);
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole('button', { name: 'Delete recipe' }).click();
  await expect(status(page)).toContainText(`“${renamed}” was deleted.`);
  await expect(page).toHaveURL(/\/recipes$/u);
  await expect(
    page.getByTestId('recipe-item').filter({ hasText: renamed }),
  ).toHaveCount(0);
});

test('validation marks the fields and keeps what was typed', async ({
  page,
}) => {
  await openRecipes(page);
  await page.getByRole('link', { name: 'Add recipe' }).click();

  await fill(page, 'Ingredient 1', 'rice');
  await page.getByRole('button', { name: 'Save recipe' }).click();

  const title = field(page, 'Title');
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toBeFocused();
  await expect(page.getByTestId('form-errors')).toContainText(
    'Enter a title between 1 and 120 characters.',
  );
  await expect(page.getByRole('group', { name: 'Steps' })).toContainText(
    'Enter between 1 and 50 steps.',
  );
  await expect(field(page, 'Ingredient 1')).toHaveValue('rice');
  await expect(page).toHaveURL(/\/recipes\/new$/u);
});

test('ingredients reorder from the keyboard, with focus following the line', async ({
  page,
}) => {
  await openRecipes(page);
  await page.getByRole('link', { name: 'Add recipe' }).click();

  for (const [index, text] of ['flour', 'sugar', 'eggs'].entries()) {
    if (index > 0) {
      await page.getByRole('button', { name: 'Add ingredient' }).click();
    }
    await fill(page, `Ingredient ${index + 1}`, text);
  }

  const lines = page.getByTestId('ingredient-line').getByRole('textbox');
  const values = () =>
    lines.evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value),
    );
  await page.getByRole('button', { name: 'Move ingredient 3 up' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(values).toEqual(['flour', 'eggs', 'sugar']);
  await expect(
    page.getByRole('button', { name: 'Move ingredient 2 up' }),
  ).toBeFocused();

  await page.keyboard.press('Space');
  await expect.poll(values).toEqual(['eggs', 'flour', 'sugar']);
  // Now at the top, focus moves to the control that still works.
  await expect(
    page.getByRole('button', { name: 'Move ingredient 1 down' }),
  ).toBeFocused();

  await page.keyboard.press('Enter');
  await expect.poll(values).toEqual(['flour', 'eggs', 'sugar']);
});

test('a stale save shows the other change and never overwrites silently', async ({
  page,
}, testInfo) => {
  await openRecipes(page);
  const title = unique('Miso soup');
  const created = await createRecipe(page, testInfo, {
    title,
    ingredients: ['miso', 'dashi'],
    steps: ['Warm the dashi.'],
  });

  await page.goto(`/recipes/${created.id}/edit`);
  await expect(field(page, 'Title')).toHaveValue(title);

  // Another member saves first, between this member loading and saving.
  const theirs = `${title} (tofu)`;
  await mutate(page.request, testInfo, 'PATCH', `/api/recipes/${created.id}`, {
    version: created.version,
    title: theirs,
    ingredients: ['miso', 'dashi', 'tofu'],
  });

  const mine = `${title} (mine)`;
  await fill(page, 'Title', mine);
  await page.getByRole('button', { name: 'Save changes' }).click();

  const conflict = page.getByTestId('recipe-conflict');
  await expect(conflict).toContainText('Another member changed this recipe');
  await expect(conflict).toContainText(theirs);
  await expect(conflict.getByText('tofu', { exact: true })).toBeVisible();
  await expect(field(page, 'Title')).toHaveValue(mine);
  await expect(
    page.getByRole('button', { name: 'Save changes' }),
  ).toBeDisabled();

  // Nothing was written: the saved recipe is still the other member's.
  const check = await page.request.get(`/api/recipes/${created.id}`);
  expect(((await check.json()) as { recipe: SavedRecipe }).recipe.title).toBe(
    theirs,
  );

  await page.getByRole('button', { name: 'Keep my changes' }).click();
  await expect(status(page)).toContainText('Your changes are kept.');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(status(page)).toContainText('Your changes were saved.');
  await expect(
    page.getByRole('heading', { level: 1, name: mine }),
  ).toBeVisible();
});

test('discarding after a conflict shows the latest version', async ({
  page,
}, testInfo) => {
  await openRecipes(page);
  const title = unique('Dal');
  const created = await createRecipe(page, testInfo, {
    title,
    ingredients: ['lentils'],
    steps: ['Simmer.'],
  });

  await page.goto(`/recipes/${created.id}/edit`);
  await expect(field(page, 'Title')).toHaveValue(title);
  const theirs = `${title} tadka`;
  await mutate(page.request, testInfo, 'PATCH', `/api/recipes/${created.id}`, {
    version: created.version,
    title: theirs,
  });

  await fill(page, 'Title', `${title} mine`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Discard my changes' }).click();

  await expect(status(page)).toContainText('Your changes were discarded.');
  await expect(
    page.getByRole('heading', { level: 1, name: theirs }),
  ).toBeVisible();
});

test('a stale delete keeps the recipe and shows the latest version', async ({
  page,
}, testInfo) => {
  await openRecipes(page);
  const title = unique('Pho');
  const created = await createRecipe(page, testInfo, {
    title,
    ingredients: ['noodles'],
    steps: ['Boil.'],
  });
  await page.goto(`/recipes/${created.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();

  const theirs = `${title} bo`;
  await mutate(page.request, testInfo, 'PATCH', `/api/recipes/${created.id}`, {
    version: created.version,
    title: theirs,
  });

  await page.getByRole('button', { name: 'Delete recipe' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete recipe' })
    .click();

  await expect(status(page)).toContainText('so it was not deleted');
  await expect(
    page.getByRole('heading', { level: 1, name: theirs }),
  ).toBeVisible();
});

test('deep links open a recipe and back returns through the history', async ({
  page,
}, testInfo) => {
  await openRecipes(page);
  const title = unique('Congee');
  const created = await createRecipe(page, testInfo, {
    title,
    ingredients: ['rice', 'water'],
    steps: ['Simmer for an hour.'],
  });

  // A direct link loads the application shell and then the recipe.
  await page.goto(`/recipes/${created.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Edit recipe' }).click();
  await expect(page).toHaveURL(new RegExp(`/recipes/${created.id}/edit$`, 'u'));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/recipes/${created.id}$`, 'u'));
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();

  await page.getByRole('link', { name: /All recipes/u }).click();
  await page.getByRole('link', { name: title }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/recipes$/u);
  await expect(page.getByRole('link', { name: title })).toBeVisible();

  // An unknown recipe says so rather than showing anything.
  await page.goto('/recipes/00000000-0000-4000-8000-000000000000');
  await expect(
    page.getByRole('heading', { name: 'Recipe not found' }),
  ).toBeVisible();
});

test('recipe text containing markup is shown literally', async ({
  page,
}, testInfo) => {
  await openRecipes(page);
  const title = `<b>x</b> ${unique('markup')}`;
  const created = await createRecipe(page, testInfo, {
    title,
    ingredients: ['<img src=x onerror="window.pwned=1">'],
    steps: ['<script>window.pwned=1</script>'],
    notes: '<a href="https://evil.test">click</a>',
  });

  await page.goto(`/recipes/${created.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: title }),
  ).toBeVisible();
  await expect(page.getByTestId('recipe-ingredients')).toHaveText(
    '<img src=x onerror="window.pwned=1">',
  );
  await expect(page.getByTestId('recipe-notes')).toHaveText(
    '<a href="https://evil.test">click</a>',
  );
  await expect(
    panel(page).locator('b, img, script, a[href*="evil"]'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => 'pwned' in window)).toBe(false);

  await page.goto('/recipes');
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await expect(panel(page).locator('b')).toHaveCount(0);
});

test('the editor fits a phone in one column with touch-sized controls', async ({
  page,
}) => {
  await openRecipes(page);
  await page.getByRole('link', { name: 'Add recipe' }).click();
  await page.getByRole('button', { name: 'Add ingredient' }).click();
  await fill(page, 'Ingredient 1', 'a long ingredient line for layout checks');

  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  const viewport = page.viewportSize();
  expect(scrollWidth).toBeLessThanOrEqual(viewport!.width);

  for (const name of [
    'Move ingredient 1 down',
    'Move ingredient 2 up',
    'Remove ingredient 1',
    'Add ingredient',
    'Save recipe',
  ]) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
    expect(box!.width, name).toBeGreaterThanOrEqual(44);
  }

  // The ingredient field stays wide enough to read what is being typed.
  const input = await field(page, 'Ingredient 1').boundingBox();
  expect(input!.width).toBeGreaterThan(200);
});

test('a non-member sees no recipes at all', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'not-a-member' }),
    }),
  );

  await page.goto('/recipes');

  await expect(
    page.getByRole('heading', { name: 'You are not a family member' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toHaveCount(0);
});
