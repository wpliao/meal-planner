import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { openedDialog } from './dialog';

// Each Playwright project gets its own local D1, loaded with the nutrition
// fixture (test/fixtures/nutrition-dataset.json) by scripts/dev-e2e.sh.
// Specs in a project share it, so every recipe has a unique title.

const unique = (prefix: string) =>
  `${prefix} ${Math.random().toString(36).slice(2, 8)}`;

const openRecipes = async (page: Page) => {
  await page.goto('/recipes');
  const setup = page.getByRole('heading', { name: 'Set up your family space' });
  const recipes = page.getByRole('heading', { level: 1, name: 'Recipes' });
  await expect(setup.or(recipes)).toBeVisible();
  if (await setup.isVisible()) {
    await page.getByLabel('Family space name').fill('E2E Family');
    await page.getByRole('button', { name: 'Create family space' }).click();
    const confirmation = await openedDialog(page);
    await confirmation
      .getByRole('button', { name: 'Create family space' })
      .click();
  }
  await expect(recipes).toBeVisible();
};

interface SavedRecipe {
  id: string;
  version: number;
}

const send = async (
  page: Page,
  testInfo: TestInfo,
  method: 'POST' | 'PATCH',
  path: string,
  data: unknown,
): Promise<SavedRecipe> => {
  const response = await page.request.fetch(path, {
    method,
    data,
    headers: {
      origin: String(testInfo.project.use.baseURL),
      'content-type': 'application/json',
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { recipe: SavedRecipe }).recipe;
};

const card = (dialog: Locator, line: string) =>
  dialog.getByRole('group', { name: line, exact: true });

/** Searches for a food in one line's card and chooses the named result. */
const chooseFood = async (
  dialog: Locator,
  line: string,
  query: string,
  food: RegExp,
) => {
  const lineCard = card(dialog, line);
  await lineCard.getByRole('textbox', { name: 'Search foods' }).fill(query);
  await lineCard.getByRole('button', { name: food }).click();
  await expect(lineCard.getByRole('textbox', { name: 'Amount' })).toBeFocused();
  return lineCard;
};

const setAmount = async (lineCard: Locator, quantity: string, unit: string) => {
  const amount = lineCard.getByRole('textbox', { name: 'Amount' });
  await amount.fill(quantity);
  await expect(amount).toHaveValue(quantity);
  await lineCard.getByRole('combobox', { name: 'Unit' }).selectOption(unit);
};

test('a member works out a recipe’s nutrition and checks a changed line', async ({
  page,
}, testInfo) => {
  await openRecipes(page);
  const lines = ['2 tbsp soy sauce', '1 large egg', 'salt to taste'];
  const recipe = await send(page, testInfo, 'POST', '/api/recipes', {
    title: unique('Soy eggs'),
    ingredients: lines,
    steps: ['Simmer the eggs in the soy sauce.'],
    servings: 2,
  });

  await page.goto(`/recipes/${recipe.id}`);
  const nutrition = page.getByTestId('recipe-nutrition');
  await expect(
    nutrition.getByText('Nutrition hasn’t been worked out for this recipe.'),
  ).toBeVisible();
  await nutrition.getByRole('button', { name: 'Work out nutrition' }).click();
  const dialog = await openedDialog(page);
  const save = dialog.getByRole('button', { name: 'Save matches' });
  await expect(
    dialog.getByText('3 left: choose a food and amount, or “Don’t count”.'),
  ).toBeVisible();

  const soy = await chooseFood(
    dialog,
    lines[0],
    'soy sauce',
    /^Soy sauce made from soy/u,
  );
  await setAmount(soy, '2', 'tbsp');
  await expect(soy.getByTestId('review-grams')).toHaveText('= 36.5 g');

  const egg = await chooseFood(
    dialog,
    lines[1],
    'egg whole raw',
    /^Egg, whole, raw, fresh/u,
  );
  await setAmount(egg, '1', 'large (50 g each)');
  await expect(egg.getByTestId('review-grams')).toHaveText('= 50 g');

  await card(dialog, lines[2])
    .getByRole('checkbox', { name: 'Don’t count' })
    .check();
  await expect(
    dialog.getByText('Every ingredient is ready to save.'),
  ).toBeVisible();
  await save.click();

  await expect(nutrition.getByText('Nutrition saved.')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  // Soy sauce 251 kJ and egg 599 kJ per 100 g: 91.6 + 299.5 = 391.1 kJ,
  // 195.6 kJ for each of 2 servings.
  const energy = nutrition
    .getByTestId('nutrition-panel')
    .getByRole('row', { name: /^Energy/u });
  await expect(energy).toContainText('196 kJ (47 kcal)');
  await expect(energy).toContainText('391 kJ (93 kcal)');
  await expect(nutrition.getByTestId('nutrition-coverage')).toHaveText(
    '2 of 3 ingredients counted.',
  );
  await expect(
    nutrition.getByText('Not counted: salt to taste.'),
  ).toBeVisible();

  // Someone changes the soy sauce line: it stops counting until checked.
  await send(page, testInfo, 'PATCH', `/api/recipes/${recipe.id}`, {
    version: recipe.version,
    ingredients: ['3 tbsp soy sauce', lines[1], lines[2]],
  });
  await page.reload();
  await expect(nutrition.getByTestId('nutrition-changed')).toContainText(
    '1 ingredient changed since nutrition was checked.',
  );
  await expect(nutrition.getByTestId('nutrition-coverage')).toHaveText(
    '1 of 3 ingredients counted.',
  );
  await nutrition.getByRole('button', { name: 'Check changed lines' }).click();
  const recheck = await openedDialog(page);
  await expect(recheck.getByTestId('review-line')).toHaveCount(1);
  const moreSoy = await chooseFood(
    recheck,
    '3 tbsp soy sauce',
    'soy sauce',
    /^Soy sauce made from soy/u,
  );
  await setAmount(moreSoy, '3', 'tbsp');
  await recheck.getByRole('button', { name: 'Save matches' }).click();

  await expect(nutrition.getByText('Nutrition saved.')).toBeVisible();
  await expect(nutrition.getByTestId('nutrition-changed')).toBeHidden();
  await expect(nutrition.getByTestId('nutrition-coverage')).toHaveText(
    '2 of 3 ingredients counted.',
  );
});
