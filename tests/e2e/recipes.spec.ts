import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { openedDialog } from './dialog';

// Each Playwright project gets its own local D1, but specs inside a project
// share it. Bootstrap only when this run still needs it, and give every
// recipe a unique title so specs never collide.
const openRecipes = async (page: Page) => {
  await page.goto('/recipes');

  // Wait for the session to answer: first-run setup or the library. A check
  // that doesn't wait can run before either renders and skip setup.
  const setup = page.getByRole('heading', { name: 'Set up your family space' });
  const library = page.getByRole('heading', { level: 1, name: 'Recipes' });
  await expect(setup.or(library)).toBeVisible();
  if (await setup.isVisible()) {
    await page.getByLabel('Family space name').fill('E2E Family');
    await page.getByRole('button', { name: 'Create family space' }).click();
    const confirmation = await openedDialog(page);
    await confirmation
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
  servings?: number | null;
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
  const dialog = await openedDialog(page);
  await expect(dialog).toContainText(`Delete “${renamed}”?`);
  await dialog.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  const confirmation = await openedDialog(page);
  await confirmation.getByRole('button', { name: 'Delete recipe' }).click();
  await expect(status(page)).toContainText(`“${renamed}” was deleted.`);
  await expect(page).toHaveURL(/\/recipes$/u);
  await expect(
    page.getByTestId('recipe-item').filter({ hasText: renamed }),
  ).toHaveCount(0);
});

test('a manual recipe keeps a link to the page it came from', async ({
  page,
}) => {
  await openRecipes(page);
  const title = unique('Teriyaki salmon');
  const link = 'https://www.kikkoman.com.sg/product_recipes/teriyaki-salmon/';

  await page.getByRole('link', { name: 'Add recipe' }).click();
  await fill(page, 'Title', title);
  await fill(page, 'Ingredient 1', '2 salmon fillets');
  await fill(page, 'Step 1', 'Pan-fry and glaze.');
  await fill(page, 'Recipe link', 'www.kikkoman.com.sg/teriyaki-salmon');
  await page.getByRole('button', { name: 'Save recipe' }).click();

  // A link that is not a whole https address is explained beside the field.
  const linkField = field(page, 'Recipe link');
  await expect(linkField).toHaveAttribute('aria-invalid', 'true');
  await expect(linkField).toBeFocused();
  await expect(page.getByTestId('form-errors')).toContainText(
    'The recipe link is not a web address.',
  );
  await expect(field(page, 'Title')).toHaveValue(title);

  await fill(page, 'Recipe link', link);
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(status(page)).toContainText(
    `“${title}” was saved to the family recipes.`,
  );
  await expect(page.getByText('Entered by hand')).toBeVisible();
  const original = page.getByRole('link', {
    name: 'Open the original recipe on www.kikkoman.com.sg (opens in a new tab)',
  });
  await expect(original).toHaveAttribute('href', link);
  await expect(original).toHaveAttribute('rel', 'noopener noreferrer');

  await page.getByRole('link', { name: /All recipes/u }).click();
  const item = page.getByTestId('recipe-item').filter({ hasText: title });
  await expect(item).toContainText('Manual · www.kikkoman.com.sg');
  await item.getByRole('link', { name: title }).click();

  // Clearing the field removes the link.
  await page.getByRole('link', { name: 'Edit recipe' }).click();
  await expect(field(page, 'Recipe link')).toHaveValue(link);
  await fill(page, 'Recipe link', '');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(status(page)).toContainText('Your changes were saved.');
  await expect(
    page.getByRole('link', { name: /original recipe/u }),
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
  const confirmation = await openedDialog(page);
  await confirmation.getByRole('button', { name: 'Delete recipe' }).click();

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

/**
 * Website import. The preview route is mocked at the network boundary in
 * every one of these, so a browser test never causes a request to a real
 * recipe site — the Worker's own limits are proved in
 * `test/worker/recipe-import.test.ts`.
 */
const IMPORT_URL = 'https://www.justonecookbook.com/oyakodon/';

const importPreview = (title: string) => ({
  draft: {
    title,
    ingredients: ['2 servings cooked rice', '½ onion', '4 large eggs'],
    steps: ['Slice the onion thinly.', 'Simmer, then cover and serve.'],
  },
  source: {
    submittedUrl: IMPORT_URL,
    resolvedUrl: null,
    host: 'www.justonecookbook.com',
    pageTitle: 'Oyakodon - Just One Cookbook',
  },
  notices: [{ field: 'ingredients', count: 2 }],
});

const stubPreview = (page: Page, body: unknown, status = 200) =>
  page.route('**/api/recipes/import-preview', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );

test('a member imports a page, reviews the copy, and saves it with its source', async ({
  page,
}) => {
  await openRecipes(page);
  const title = unique('Oyakodon');
  await stubPreview(page, importPreview(title));

  await page.getByRole('link', { name: 'Import from a website' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Import a recipe' }),
  ).toBeVisible();
  // The screen says plainly that a site will be contacted.
  await expect(panel(page)).toContainText('will contact that website');

  await fill(page, 'Recipe page link', IMPORT_URL);
  await page.getByRole('button', { name: 'Get the recipe' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Review imported recipe' }),
  ).toBeVisible();
  const review = page.getByTestId('import-review');
  await expect(review).toContainText(
    'The text below was copied from www.justonecookbook.com.',
  );
  await expect(review).toContainText('2 ingredient lines were left out');
  await expect(
    review.getByRole('link', { name: /Open the original recipe/u }),
  ).toHaveAttribute('href', IMPORT_URL);

  // The draft is editable before it is saved.
  await expect(field(page, 'Title')).toHaveValue(title);
  await fill(page, 'Ingredient 2', '1 small onion');
  await page.getByRole('button', { name: 'Save recipe' }).click();

  await expect(status(page)).toContainText(
    `“${title}” was saved to the family recipes.`,
  );
  await expect(
    page.getByTestId('recipe-ingredients').getByRole('listitem'),
  ).toHaveText(['2 servings cooked rice', '1 small onion', '4 large eggs']);
  await expect(
    page.getByRole('link', {
      name: /Open the original recipe on www\.justonecookbook\.com/u,
    }),
  ).toHaveAttribute('href', IMPORT_URL);

  // The library shows where the copy came from.
  await page.getByRole('link', { name: /All recipes/u }).click();
  await expect(
    page.getByTestId('recipe-item').filter({ hasText: title }),
  ).toContainText('www.justonecookbook.com');
});

test('a failed import explains itself and leaves manual entry open', async ({
  page,
}) => {
  await openRecipes(page);
  await stubPreview(
    page,
    {
      error: {
        code: 'import_failed',
        message: 'That page does not publish recipe details this app can read.',
      },
      reason: 'unsupported_source',
    },
    422,
  );

  await page.goto('/recipes/import');
  await fill(page, 'Recipe page link', IMPORT_URL);
  await page.getByRole('button', { name: 'Get the recipe' }).click();

  await expect(page.getByTestId('import-failed')).toContainText(
    'does not publish recipe details this app can read',
  );
  // Nothing was created, and the link is still there to correct.
  await expect(field(page, 'Recipe page link')).toHaveValue(IMPORT_URL);

  await page.getByRole('link', { name: 'Enter it by hand' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'New recipe' }),
  ).toBeVisible();

  // A link the form itself refuses never reaches the Worker at all.
  await page.goBack();
  await fill(page, 'Recipe page link', 'https://example.com/recipe');
  await page.getByRole('button', { name: 'Get the recipe' }).click();
  await expect(field(page, 'Recipe page link')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByTestId('import-failed')).toHaveCount(0);
});

test('the import screen fits a phone with touch-sized controls', async ({
  page,
}) => {
  await openRecipes(page);
  await page.goto('/recipes/import');
  await fill(page, 'Recipe page link', `${IMPORT_URL}a-very-long-recipe-slug/`);

  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  const viewport = page.viewportSize();
  expect(scrollWidth).toBeLessThanOrEqual(viewport!.width);

  for (const name of ['Get the recipe', 'Enter it by hand']) {
    const control = page
      .getByRole('button', { name })
      .or(page.getByRole('link', { name }));
    const box = await control.boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
    expect(box!.width, name).toBeGreaterThanOrEqual(44);
  }

  // The link field stays wide enough to check a pasted address.
  const input = await field(page, 'Recipe page link').boundingBox();
  expect(input!.width).toBeGreaterThan(200);
});

test('a member adjusts servings and units on the recipe page', async ({
  page,
}, testInfo) => {
  await openRecipes(page);
  const saved = await createRecipe(page, testInfo, {
    title: unique('Baked thighs'),
    ingredients: ['1 lb chicken thighs', '2 eggs', 'salt to taste'],
    steps: ['Bake at 375°F in a 9x13-inch pan.'],
    servings: 4,
  });
  await page.goto(`/recipes/${saved.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: saved.title }),
  ).toBeVisible();

  const ingredients = page
    .getByTestId('recipe-ingredients')
    .getByRole('listitem');
  const steps = page.getByTestId('recipe-steps').getByRole('listitem');
  const servings = page.getByRole('textbox', { name: 'Servings' });
  // A segmented control's radio is hidden; its label is what a member taps.
  const unit = (name: string) =>
    page.locator('label').filter({ hasText: new RegExp(`^${name}$`, 'u') });

  // Metric is the default, so the imperial recipe reads in metric.
  await expect(ingredients).toHaveText([
    '455 g chicken thighs',
    '2 eggs',
    'salt to taste',
  ]);
  await expect(steps).toHaveText(['Bake at 190°C in a 23 x 33 cm pan.']);
  await expect(page.getByTestId('recipe-amounts-note')).toHaveText(
    'Amounts are converted to metric and rounded. Edit recipe shows them as written.',
  );

  await page.getByRole('button', { name: 'More servings' }).click();
  await page.getByRole('button', { name: 'More servings' }).click();
  await expect(servings).toHaveValue('6');
  await expect(ingredients).toHaveText([
    '680 g chicken thighs',
    '3 eggs',
    'salt to taste',
  ]);
  await expect(page.getByTestId('recipe-steps-note')).toHaveText(
    'Amounts in the steps are for 4 servings.',
  );
  await expect(page.getByTestId('recipe-amounts-status')).toHaveText(
    'Showing amounts for 6 servings, in metric.',
  );

  await unit('Imperial').click();
  await expect(ingredients).toHaveText([
    '1 ½ lb chicken thighs',
    '3 eggs',
    'salt to taste',
  ]);
  await expect(steps).toHaveText(['Bake at 375°F in a 9x13-inch pan.']);

  // The controls are touch-sized and the page does not scroll sideways.
  for (const control of [
    page.getByRole('button', { name: 'Fewer servings' }),
    page.getByRole('button', { name: 'More servings' }),
    page.getByRole('button', { name: 'Reset' }),
    servings,
    unit('Metric'),
    unit('Imperial'),
  ]) {
    const box = await control.boundingBox();
    const name = String(control);
    expect(box, name).not.toBeNull();
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
    expect(box!.width, name).toBeGreaterThanOrEqual(44);
  }
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth).toBeLessThanOrEqual(page.viewportSize()!.width);

  // Units are remembered on this device; servings start again each visit.
  await page.reload();
  await expect(servings).toHaveValue('4');
  await expect(page.getByRole('radio', { name: 'Imperial' })).toBeChecked();
  await expect(ingredients).toHaveText([
    '1 lb chicken thighs',
    '2 eggs',
    'salt to taste',
  ]);

  // The editor still shows the saved text as written.
  await unit('Metric').click();
  await page.getByRole('link', { name: 'Edit recipe' }).click();
  await expect(field(page, 'Ingredient 1')).toHaveValue('1 lb chicken thighs');
  await expect(field(page, 'Step 1')).toHaveValue(
    'Bake at 375°F in a 9x13-inch pan.',
  );
});
