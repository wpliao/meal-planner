import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { openedDialog } from './dialog';

/**
 * Each Playwright project has its own local D1, shared by the specs inside it
 * and run in parallel, so every test here plans into its own week and uses
 * unique titles. Weeks are counted from the real current week, because the
 * Worker's write window follows the real date.
 */

const unique = (prefix: string) =>
  `${prefix} ${Math.random().toString(36).slice(2, 8)}`;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);
const addDays = (date: string, days: number) =>
  isoDate(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
const mondayOf = (date: string) => {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
};
/** "Thursday 24 September", as the day headings read. */
const dayName = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[(value.getUTCDay() + 6) % 7]} ${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]}`;
};

/** The Monday `offset` weeks after the current UTC week. */
const futureWeek = (offset: number) =>
  addDays(mondayOf(isoDate(Date.now())), 7 * offset);

/**
 * The Monday `offset` weeks before the current UTC week: a week that has
 * ended, still inside the write window so a test can plan into it.
 */
const pastWeek = (offset: number) => futureWeek(-offset);

const openPlan = async (page: Page, path: string) => {
  await page.goto(path);
  // Wait until the session has answered: either the plan or first-run setup.
  const setup = page.getByRole('heading', { name: 'Set up your family space' });
  const plan = page.getByRole('heading', { level: 1, name: 'Plan' });
  await expect(setup.or(plan)).toBeVisible();
  if (await setup.isVisible()) {
    await page.getByLabel('Family space name').fill('E2E Family');
    await page.getByRole('button', { name: 'Create family space' }).click();
    const confirmation = await openedDialog(page);
    await confirmation
      .getByRole('button', { name: 'Create family space' })
      .click();
    await page.goto(path);
  }
  await expect(
    page.getByRole('heading', { level: 1, name: 'Plan' }),
  ).toBeVisible();
  await expect(page.getByTestId('plan-days')).toBeVisible();
};

const day = (page: Page, date: string) =>
  page.getByRole('region', { name: dayName(date) });
const slot = (page: Page, date: string, meal: string) =>
  day(page, date).getByTestId(`slot-${meal}`);
const result = (page: Page) => page.getByTestId('plan-result');

/** A same-origin JSON request, as the Worker requires of mutations. */
const call = async <T>(
  request: APIRequestContext,
  testInfo: TestInfo,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  data: unknown,
): Promise<T> => {
  const response = await request.fetch(path, {
    method,
    data,
    headers: {
      origin: String(testInfo.project.use.baseURL),
      'content-type': 'application/json',
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (response.status() === 204 ? undefined : await response.json()) as T;
};

interface Saved {
  id: string;
  version: number;
  title: string;
}

const createRecipe = async (
  page: Page,
  testInfo: TestInfo,
  title: string,
): Promise<Saved> =>
  (
    await call<{ recipe: Saved }>(
      page.request,
      testInfo,
      'POST',
      '/api/recipes',
      {
        title,
        ingredients: ['rice'],
        steps: ['Cook it.'],
      },
    )
  ).recipe;

const createEntry = async (
  page: Page,
  testInfo: TestInfo,
  body: Record<string, unknown>,
): Promise<Saved> =>
  (
    await call<{ entry: Saved }>(
      page.request,
      testInfo,
      'POST',
      '/api/meal-plan/entries',
      body,
    )
  ).entry;

test('home is the plan, first in the navigation', async ({ page }) => {
  await openPlan(page, '/');
  await expect(page).toHaveURL(/\/plan$/u);
  await expect(
    page.getByRole('navigation', { name: 'Sections' }).getByRole('link'),
  ).toHaveText(['Plan', 'Pantry', 'Recipes', 'Family']);
});

test('a member plans a recipe and a typed meal, moves one, edits a note, and removes one', async ({
  page,
}, testInfo) => {
  const monday = futureWeek(2);
  const tuesday = addDays(monday, 1);
  const wednesday = addDays(monday, 2);
  await openPlan(page, '/plan');
  const recipeTitle = unique('Soy chicken');
  const recipe = await createRecipe(page, testInfo, recipeTitle);
  await openPlan(page, `/plan/${monday}`);

  // A recipe, found by searching the library.
  await slot(page, monday, 'dinner')
    .getByRole('button', { name: `Add to dinner, ${dayName(monday)}` })
    .click();
  let dialog = await openedDialog(page);
  // The recipe field searches the library as the member types.
  await dialog.getByRole('combobox', { name: 'Recipe' }).fill(recipeTitle);
  await page.getByRole('option', { name: recipeTitle }).click();
  await expect(dialog.getByRole('combobox', { name: 'Recipe' })).toHaveValue(
    recipeTitle,
  );
  await dialog.getByRole('textbox', { name: /Note/u }).fill('double batch');
  await dialog.getByRole('button', { name: 'Add to plan' }).click();
  await expect(result(page)).toContainText(
    `Added “${recipeTitle}” to dinner on ${dayName(monday)}.`,
  );
  const dinner = slot(page, monday, 'dinner');
  await expect(dinner.getByRole('link', { name: recipeTitle })).toHaveAttribute(
    'href',
    `/recipes/${recipe.id}`,
  );
  await expect(dinner).toContainText('double batch');
  await expect(
    dinner.getByRole('button', { name: `Add to dinner, ${dayName(monday)}` }),
  ).toBeFocused();

  // A typed meal.
  const typed = unique('Leftovers');
  await slot(page, tuesday, 'lunch')
    .getByRole('button', { name: /^Add to lunch/u })
    .click();
  dialog = await openedDialog(page);
  await dialog.getByRole('radio', { name: 'Type a meal' }).check();
  await dialog.getByRole('textbox', { name: 'Meal' }).fill(typed);
  await dialog.getByRole('button', { name: 'Add to plan' }).click();
  await expect(slot(page, tuesday, 'lunch')).toContainText(typed);

  // Move it to Wednesday's dinner.
  await page
    .getByRole('button', { name: new RegExp(`Actions for ${typed}`, 'u') })
    .click();
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
  dialog = await openedDialog(page);
  await dialog.getByLabel('Date').fill(wednesday);
  await dialog.getByRole('combobox', { name: 'Meal' }).selectOption('dinner');
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(result(page)).toContainText(
    `Moved “${typed}” to dinner on ${dayName(wednesday)}.`,
  );
  await expect(slot(page, tuesday, 'lunch')).not.toContainText(typed);
  await expect(slot(page, wednesday, 'dinner')).toContainText(typed);

  // Edit the recipe entry's note.
  await page
    .getByRole('button', {
      name: new RegExp(`Actions for ${recipeTitle}`, 'u'),
    })
    .click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  dialog = await openedDialog(page);
  await dialog.getByRole('textbox', { name: /Note/u }).fill('with greens');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dinner).toContainText('with greens');

  // Remove the typed meal.
  await page
    .getByRole('button', { name: new RegExp(`Actions for ${typed}`, 'u') })
    .click();
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
  dialog = await openedDialog(page);
  await expect(dialog).toContainText(`Remove “${typed}”?`);
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(result(page)).toContainText(`Removed “${typed}”`);
  await expect(page.getByTestId('plan-days')).not.toContainText(typed);

  // The plan opens the recipe.
  await dinner.getByRole('link', { name: recipeTitle }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: recipeTitle }),
  ).toBeVisible();
});

test('a recipe page adds it to the plan and links to that week', async ({
  page,
}, testInfo) => {
  const monday = futureWeek(3);
  const thursday = addDays(monday, 3);
  await openPlan(page, '/plan');
  const title = unique('Miso soup');
  const recipe = await createRecipe(page, testInfo, title);

  await page.goto(`/recipes/${recipe.id}`);
  await page.getByRole('button', { name: 'Add to plan' }).click();
  const dialog = await openedDialog(page);
  await dialog.getByLabel('Date').fill(thursday);
  await dialog.getByRole('combobox', { name: 'Meal' }).selectOption('lunch');
  await dialog.getByRole('button', { name: 'Add to plan' }).click();
  await expect(dialog.getByTestId('plan-added')).toHaveText(
    `Planned for lunch on ${dayName(thursday)}.`,
  );
  await dialog
    .getByRole('link', { name: `Open the week of ${dayName(monday)}` })
    .click();

  await expect(page).toHaveURL(new RegExp(`/plan/${monday}$`, 'u'));
  await expect(
    slot(page, thursday, 'lunch').getByRole('link', { name: title }),
  ).toBeVisible();
});

test('a stale change shows the other member’s version and can be applied to it', async ({
  page,
}, testInfo) => {
  const monday = futureWeek(4);
  await openPlan(page, '/plan');
  const title = unique('Curry');
  const entry = await createEntry(page, testInfo, {
    date: monday,
    slot: 'dinner',
    title,
  });
  await openPlan(page, `/plan/${monday}`);

  // Another member moves it to lunch after this page loaded.
  await call(
    page.request,
    testInfo,
    'PATCH',
    `/api/meal-plan/entries/${entry.id}`,
    {
      version: entry.version,
      slot: 'lunch',
      note: 'mild',
    },
  );

  await page
    .getByRole('button', { name: new RegExp(`Actions for ${title}`, 'u') })
    .click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = await openedDialog(page);
  await dialog.getByRole('textbox', { name: /Note/u }).fill('extra hot');
  await dialog.getByRole('button', { name: 'Save' }).click();

  const conflict = dialog.getByTestId('entry-conflict');
  await expect(conflict).toContainText('Your change was not saved.');
  await expect(conflict).toContainText(
    `It is now “${title}” (mild), lunch on ${dayName(monday)}.`,
  );
  await expect(dialog.getByRole('textbox', { name: /Note/u })).toHaveValue(
    'extra hot',
  );

  await conflict
    .getByRole('button', { name: 'Apply my change to the latest version' })
    .click();
  await expect(result(page)).toContainText(
    'Your changes to the meal were saved.',
  );
  // The other member's move stands; only the note changed.
  await expect(slot(page, monday, 'lunch')).toContainText('extra hot');
  await expect(slot(page, monday, 'dinner')).not.toContainText(title);
});

test('a deleted recipe stays on the plan under its last title', async ({
  page,
}, testInfo) => {
  const monday = futureWeek(5);
  await openPlan(page, '/plan');
  const title = unique('Old stew');
  const recipe = await createRecipe(page, testInfo, title);
  await createEntry(page, testInfo, {
    date: monday,
    slot: 'dinner',
    recipeId: recipe.id,
  });
  await call(page.request, testInfo, 'DELETE', `/api/recipes/${recipe.id}`, {
    version: recipe.version,
  });

  await openPlan(page, `/plan/${monday}`);
  const dinner = slot(page, monday, 'dinner');
  await expect(dinner).toContainText(title);
  await expect(dinner).toContainText('No longer in the recipe library');
  await expect(dinner.getByRole('link', { name: title })).toHaveCount(0);
});

test('week links are real URLs and back returns through them', async ({
  page,
}) => {
  const monday = futureWeek(6);
  const next = addDays(monday, 7);

  // A date that is not a Monday opens its week, replacing the URL.
  await openPlan(page, `/plan/${addDays(monday, 2)}`);
  await expect(page).toHaveURL(new RegExp(`/plan/${monday}$`, 'u'));

  await page.getByRole('link', { name: 'Next week' }).click();
  await expect(page).toHaveURL(new RegExp(`/plan/${next}$`, 'u'));
  await expect(day(page, next)).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/plan/${monday}$`, 'u'));
  await expect(day(page, monday)).toBeVisible();

  await page.getByRole('link', { name: 'Previous week' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/plan/${addDays(monday, -7)}$`, 'u'),
  );

  await page.getByRole('link', { name: 'This week' }).click();
  await expect(page.getByText('Today', { exact: true })).toBeVisible();

  // An invalid date opens the current week.
  await page.goto('/plan/not-a-date');
  await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}-\d{2}$/u);
  await expect(page.getByText('Today', { exact: true })).toBeVisible();
});

test('the week fits a phone with touch-sized controls', async ({
  page,
}, testInfo) => {
  const monday = futureWeek(7);
  await openPlan(page, `/plan/${monday}`);

  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(scrollWidth).toBeLessThanOrEqual(page.viewportSize()!.width);

  for (const name of [
    'Previous week',
    'This week',
    'Next week',
    `Add to breakfast, ${dayName(monday)}`,
  ]) {
    const box = await page
      .getByRole(name.startsWith('Add') ? 'button' : 'link', { name })
      .boundingBox();
    expect(box, name).not.toBeNull();
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
  }

  // On a phone the days form one column; on a desktop they share rows.
  const boxes = await page
    .getByTestId('plan-day')
    .evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().left),
    );
  const columns = new Set(boxes.map(Math.round)).size;
  if (testInfo.project.name.endsWith('mobile')) {
    expect(columns).toBe(1);
  } else {
    expect(columns).toBeGreaterThan(1);
  }

  await page
    .getByRole('button', { name: `Add to breakfast, ${dayName(monday)}` })
    .click();
  const dialog = await openedDialog(page);
  const recipe = dialog.getByRole('combobox', { name: 'Recipe' });
  await expect(recipe).toBeVisible();
  expect((await recipe.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await dialog.getByRole('radio', { name: 'Type a meal' }).check();
  for (const control of [
    dialog.getByRole('textbox', { name: 'Meal' }),
    dialog.getByRole('button', { name: 'Add to plan' }),
  ]) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test('a keyboard alone plans a meal and lands back on Add', async ({
  page,
}) => {
  const monday = futureWeek(8);
  await openPlan(page, `/plan/${monday}`);
  const title = unique('Pancakes');
  const add = page.getByRole('button', {
    name: `Add to breakfast, ${dayName(monday)}`,
  });

  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = await openedDialog(page);
  const typeMeal = dialog.getByRole('radio', { name: 'Type a meal' });
  await dialog.getByRole('radio', { name: 'Pick a recipe' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(typeMeal).toBeChecked();
  await dialog.getByRole('textbox', { name: 'Meal' }).focus();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');

  await expect(result(page)).toContainText(`Added “${title}”`);
  await expect(add).toBeFocused();

  // Escape closes a dialog and returns focus to the control that opened it.
  const actions = page.getByRole('button', {
    name: new RegExp(`Actions for ${title}`, 'u'),
  });
  await actions.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).focus();
  await page.keyboard.press('Enter');
  await openedDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(actions).toBeFocused();
});

// ---------------------------------------------------------------------------
// Suggestions (#73)

/** A word of letters only, unlike any other test's, so matches are ours. */
const randomWord = (prefix: string) =>
  prefix +
  Array.from(
    { length: 8 },
    () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)],
  ).join('');

const createPantryItem = (
  page: Page,
  testInfo: TestInfo,
  name: string,
  status: 'available' | 'low' | 'needed',
) =>
  call(page.request, testInfo, 'POST', '/api/pantry/items', { name, status });

const createRecipeWith = async (
  page: Page,
  testInfo: TestInfo,
  title: string,
  ingredients: string[],
): Promise<Saved> =>
  (
    await call<{ recipe: Saved }>(
      page.request,
      testInfo,
      'POST',
      '/api/recipes',
      { title, ingredients, steps: ['Cook it.'] },
    )
  ).recipe;

test('a member plans a suggested recipe, with reasons from the pantry and the plan', async ({
  page,
}, testInfo) => {
  const monday = futureWeek(11);
  const thursday = addDays(monday, 3);
  const friday = addDays(monday, 4);
  await openPlan(page, '/plan');

  // Five items at home, one of them low, and one needed. The prefixes fix
  // their order in the reason, which lists names in order.
  const held = ['a', 'b', 'c', 'd', 'e'].map(randomWord);
  const needed = randomWord('n');
  for (const [index, name] of held.entries()) {
    await createPantryItem(
      page,
      testInfo,
      name,
      index === 1 ? 'low' : 'available',
    );
  }
  await createPantryItem(page, testInfo, needed, 'needed');
  const title = unique('Harvest bowl');
  await createRecipeWith(page, testInfo, title, [
    `200 g ${held[0]}s`,
    `1 ${held[1]}, chopped`,
    `${held[2]} (optional)`,
    `2 tbsp ${held[3]}`,
    `a handful of ${held[4]}`,
    `1 tsp ${needed}`,
  ]);
  await openPlan(page, `/plan/${monday}`);

  await slot(page, thursday, 'dinner')
    .getByRole('button', { name: `Add to dinner, ${dayName(thursday)}` })
    .click();
  let dialog = await openedDialog(page);
  let group = dialog.getByRole('radiogroup', {
    name: 'Suggested for Thursday dinner',
  });
  let option = group.getByRole('radio', { name: title });
  await expect(option).toBeVisible();
  await expect(option).toHaveAccessibleDescription(
    new RegExp(
      `^Uses what you have: ${held[0]}, ${held[1]} \\(low\\), ${held[2]}, ${held[3]} and 1 more · Needs: ${needed}\\s*Not planned before$`,
      'u',
    ),
  );

  // The option's label and its Not now button (#78) together span the
  // group, each a touch target, and the dialog does not scroll sideways on a
  // phone.
  const label = page.locator(`label[for="${await option.getAttribute('id')}"]`);
  const labelBox = (await label.boundingBox())!;
  const notNowBox = (await dialog
    .getByRole('button', { name: `Not now: ${title}` })
    .boundingBox())!;
  const groupBox = (await group.boundingBox())!;
  expect(labelBox.height).toBeGreaterThanOrEqual(44);
  expect(notNowBox.height).toBeGreaterThanOrEqual(44);
  expect(labelBox.width + notNowBox.width).toBeGreaterThan(
    groupBox.width * 0.75,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);

  await label.click();
  await expect(option).toBeChecked();
  await expect(dialog.getByRole('combobox', { name: 'Recipe' })).toHaveValue(
    title,
  );
  await dialog.getByRole('button', { name: 'Add to plan' }).click();
  await expect(result(page)).toContainText(
    `Added “${title}” to dinner on ${dayName(thursday)}.`,
  );
  await expect(
    slot(page, thursday, 'dinner').getByRole('link', { name: title }),
  ).toBeVisible();

  // The next day, the same recipe says when it is already planned.
  await slot(page, friday, 'dinner')
    .getByRole('button', { name: `Add to dinner, ${dayName(friday)}` })
    .click();
  dialog = await openedDialog(page);
  group = dialog.getByRole('radiogroup', {
    name: 'Suggested for Friday dinner',
  });
  option = group.getByRole('radio', { name: title });
  await expect(option).toHaveAccessibleDescription(
    new RegExp(`Also planned on ${dayName(thursday)}$`, 'u'),
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('a keyboard alone chooses a suggestion and plans it', async ({
  page,
}, testInfo) => {
  const monday = futureWeek(12);
  const saturday = addDays(monday, 5);
  await openPlan(page, '/plan');
  // At least two recipes, so there are two suggestions to move between.
  await createRecipeWith(page, testInfo, unique('Omelette'), ['eggs']);
  await createRecipeWith(page, testInfo, unique('Porridge'), ['oats']);
  await openPlan(page, `/plan/${monday}`);

  const add = page.getByRole('button', {
    name: `Add to breakfast, ${dayName(saturday)}`,
  });
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = await openedDialog(page);
  const group = dialog.getByRole('radiogroup', {
    name: 'Suggested for Saturday breakfast',
  });
  const radios = group.getByRole('radio');
  await expect(radios.nth(1)).toBeVisible();

  // Tab leaves "What to add" for the suggestions; arrows choose among them.
  await dialog.getByRole('radio', { name: 'Pick a recipe' }).focus();
  await page.keyboard.press('Tab');
  await expect(radios.first()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(radios.first()).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(radios.nth(1)).toBeFocused();
  await expect(radios.nth(1)).toBeChecked();
  const chosen = await radios.nth(1).evaluate((radio) => {
    const id = radio.getAttribute('aria-labelledby') ?? '';
    return document.getElementById(id)?.textContent ?? '';
  });
  await expect(dialog.getByRole('combobox', { name: 'Recipe' })).toHaveValue(
    chosen,
  );

  // Tab passes the Not now buttons (#78) of the chosen option and those
  // after it, then reaches the recipe field; on to the note, and Enter adds
  // it.
  const recipeField = dialog.getByRole('combobox', { name: 'Recipe' });
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: `Not now: ${chosen}` }),
  ).toBeFocused();
  for (let stop = 0; stop < 5; stop += 1) {
    if (await recipeField.evaluate((field) => field === document.activeElement))
      break;
    await expect(page.locator(':focus')).toHaveAccessibleName(/^Not now: /u);
    await page.keyboard.press('Tab');
  }
  await expect(recipeField).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('textbox', { name: /Note/u })).toBeFocused();
  await page.keyboard.type('by keyboard');
  await page.keyboard.press('Enter');
  await expect(result(page)).toContainText(
    `Added “${chosen}” to breakfast on ${dayName(saturday)}.`,
  );
  await expect(add).toBeFocused();
});

// ---------------------------------------------------------------------------
// Favourites and Not now (#78)

/**
 * A recipe that uses six pantry items no other test has, so it ranks among
 * the first five suggestions whatever else the shared library holds.
 */
const createSuggestedRecipe = async (
  page: Page,
  testInfo: TestInfo,
  title: string,
): Promise<{ recipe: Saved; held: string[] }> => {
  const held = ['a', 'b', 'c', 'd', 'e', 'f'].map(randomWord);
  for (const name of held) {
    await createPantryItem(page, testInfo, name, 'available');
  }
  const recipe = await createRecipeWith(
    page,
    testInfo,
    title,
    held.map((name) => `1 ${name}`),
  );
  return { recipe, held };
};

const setPreference = (
  page: Page,
  testInfo: TestInfo,
  id: string,
  body: Record<string, boolean>,
) =>
  call(page.request, testInfo, 'PUT', `/api/recipes/${id}/preferences`, body);

test('a favourite marked on the recipe page leads its suggestion', async ({
  page,
}, testInfo) => {
  const monday = futureWeek(13);
  await openPlan(page, '/plan');
  const title = unique('Family stew');
  const { recipe, held } = await createSuggestedRecipe(page, testInfo, title);

  await page.goto(`/recipes/${recipe.id}`);
  const favourite = page.getByRole('button', { name: 'Mark as favourite' });
  await expect(favourite).toHaveAttribute('aria-pressed', 'false');
  expect((await favourite.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await favourite.click();
  await expect(favourite).toHaveAttribute('aria-pressed', 'true');
  await expect(favourite).toHaveText(/Favourite/u);
  // Another member's view is the same: it is the household's.
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Mark as favourite' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await openPlan(page, `/plan/${monday}`);
  await slot(page, monday, 'dinner')
    .getByRole('button', { name: `Add to dinner, ${dayName(monday)}` })
    .click();
  const dialog = await openedDialog(page);
  const option = dialog
    .getByRole('radiogroup', { name: 'Suggested for Monday dinner' })
    .getByRole('radio', { name: title });
  await expect(option).toHaveAccessibleDescription(
    new RegExp(
      `^Family favourite · Uses what you have: ${held[0]}, ${held[1]}, ${held[2]}, ${held[3]} and 2 more`,
      'u',
    ),
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await setPreference(page, testInfo, recipe.id, { favourite: false });
});

test('Not now hides a suggestion; Undo and the recipe page bring it back, by keyboard', async ({
  page,
}, testInfo) => {
  const monday = futureWeek(14);
  await openPlan(page, '/plan');
  const title = unique('Weeknight bake');
  const { recipe } = await createSuggestedRecipe(page, testInfo, title);
  // A favourite too, so it ranks above any other test's recipe with as many
  // pantry matches.
  await setPreference(page, testInfo, recipe.id, { favourite: true });
  await openPlan(page, `/plan/${monday}`);

  const add = page.getByRole('button', {
    name: `Add to lunch, ${dayName(monday)}`,
  });
  await add.focus();
  await page.keyboard.press('Enter');
  let dialog = await openedDialog(page);
  const group = dialog.getByRole('radiogroup', {
    name: 'Suggested for Monday lunch',
  });
  await expect(group.getByRole('radio', { name: title })).toBeVisible();

  const notNow = dialog.getByRole('button', { name: `Not now: ${title}` });
  expect((await notNow.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await notNow.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByTestId('not-now-status')).toHaveText(
    `“${title}” is hidden from suggestions for 7 days.`,
  );
  const undo = dialog.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeFocused();
  await expect(group.getByRole('radio', { name: title })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.keyboard.press('Enter');
  const restored = group.getByRole('radio', { name: title });
  await expect(restored).toBeFocused();
  await expect(dialog.getByTestId('not-now-status')).toHaveCount(0);

  // Hide it again and leave; the recipe page offers to show it again.
  await dialog.getByRole('button', { name: `Not now: ${title}` }).click();
  await expect(dialog.getByTestId('not-now-status')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.goto(`/recipes/${recipe.id}`);
  const hidden = page.getByTestId('recipe-not-now');
  await expect(hidden).toContainText('Hidden from suggestions until');
  await hidden.getByRole('button', { name: 'Show in suggestions' }).click();
  await expect(hidden).toHaveCount(0);
  await expect(page.getByTestId('recipe-result')).toHaveText(
    `“${title}” can be suggested again.`,
  );

  await openPlan(page, `/plan/${monday}`);
  await add.click();
  dialog = await openedDialog(page);
  await expect(
    dialog
      .getByRole('radiogroup', { name: 'Suggested for Monday lunch' })
      .getByRole('radio', { name: title }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await setPreference(page, testInfo, recipe.id, { favourite: false });
});

test('a member clears a past week, and only a past week offers it', async ({
  page,
}, testInfo) => {
  const monday = pastWeek(2);
  const future = futureWeek(9);
  for (const [date, slotName, title] of [
    [monday, 'dinner', unique('Curry')],
    [addDays(monday, 4), 'lunch', unique('Soup')],
    [future, 'dinner', unique('Later')],
  ]) {
    await createEntry(page, testInfo, { date, slot: slotName, title });
  }

  // Neither the current week nor a future one can be cleared.
  await openPlan(page, '/plan');
  const clearButton = page.getByRole('button', { name: /^Clear this week/u });
  await expect(clearButton).toHaveCount(0);
  await openPlan(page, `/plan/${future}`);
  await expect(page.getByTestId('plan-entry')).toHaveCount(1);
  await expect(clearButton).toHaveCount(0);

  await openPlan(page, `/plan/${monday}`);
  const heading = (await page.getByTestId('plan-week').textContent()) ?? '';
  await expect(page.getByTestId('plan-entry')).toHaveCount(2);
  await expect(clearButton).toHaveAccessibleName(`Clear this week, ${heading}`);
  expect((await clearButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await clearButton.click();
  const dialog = await openedDialog(page);
  await expect(dialog).toHaveAccessibleName(`Clear ${heading}?`);
  await expect(dialog).toContainText(
    'This removes all 2 planned meals in this week for everyone.',
  );
  await dialog.getByRole('button', { name: 'Clear week' }).click();

  await expect(result(page)).toContainText(
    `Cleared 2 planned meals from ${heading}.`,
  );
  await expect(page.getByTestId('plan-empty')).toBeVisible();
  await expect(clearButton).toHaveCount(0);
  await expect(page.getByTestId('plan-week')).toBeFocused();

  // It stays cleared for everyone.
  await page.reload();
  await expect(page.getByTestId('plan-empty')).toBeVisible();
});

test('a clear after another member changed the week shows the new count and can clear it', async ({
  page,
}, testInfo) => {
  const monday = pastWeek(3);
  await createEntry(page, testInfo, {
    date: monday,
    slot: 'dinner',
    title: unique('Curry'),
  });
  await createEntry(page, testInfo, {
    date: addDays(monday, 2),
    slot: 'breakfast',
    title: unique('Toast'),
  });
  await openPlan(page, `/plan/${monday}`);
  await expect(page.getByTestId('plan-entry')).toHaveCount(2);

  // Another member plans one more meal after this page loaded the week.
  const late = unique('Late supper');
  await createEntry(page, testInfo, {
    date: addDays(monday, 6),
    slot: 'dinner',
    title: late,
  });

  await page.getByRole('button', { name: /^Clear this week/u }).click();
  const dialog = await openedDialog(page);
  await dialog.getByRole('button', { name: 'Clear week' }).click();
  const conflict = dialog.getByTestId('week-conflict');
  await expect(conflict).toContainText(
    'This week changed after you opened it, so nothing was removed. It now has 3 planned meals.',
  );
  // The week behind the dialog shows the other member's meal.
  await expect(page.getByTestId('plan-days')).toContainText(late);

  await conflict.getByRole('button', { name: 'Clear all 3' }).click();
  await expect(result(page)).toContainText('Cleared 3 planned meals');
  await expect(page.getByTestId('plan-empty')).toBeVisible();
});

test('a keyboard alone clears a past week', async ({ page }, testInfo) => {
  const monday = pastWeek(4);
  await createEntry(page, testInfo, {
    date: addDays(monday, 1),
    slot: 'lunch',
    title: unique('Noodles'),
  });
  await openPlan(page, `/plan/${monday}`);
  const clearButton = page.getByRole('button', { name: /^Clear this week/u });

  // Escape closes the confirmation and returns focus to Clear.
  await clearButton.focus();
  await page.keyboard.press('Enter');
  let dialog = await openedDialog(page);
  await expect(dialog).toContainText('This removes the 1 planned meal');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(clearButton).toBeFocused();

  await page.keyboard.press('Enter');
  dialog = await openedDialog(page);
  await dialog.getByRole('button', { name: 'Clear week' }).focus();
  await page.keyboard.press('Enter');
  await expect(result(page)).toContainText('Cleared 1 planned meal from');
  await expect(page.getByTestId('plan-week')).toBeFocused();
});

test('a non-member sees no plan and the plan is never requested', async ({
  page,
}) => {
  const planRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/meal-plan'))
      planRequests.push(request.url());
  });
  await page.route('**/api/session', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'not-a-member' }),
    }),
  );

  await page.goto('/plan');
  await expect(
    page.getByRole('heading', { name: 'You are not a family member' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan' })).toHaveCount(0);
  expect(planRequests).toEqual([]);
});

/**
 * "Today" and saved dates follow the device's own calendar day, whatever the
 * UTC date is. The clock is pinned a few minutes from local midnight, on a day
 * a little ahead of the real one so the Worker's write window accepts it.
 */
const localOffsetMinutes = (timeZone: string, at: number): number => {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(at))
    .find((part) => part.type === 'timeZoneName')!.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/u.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
};

/**
 * The instant that is `hh:mm` local time on `date` in `timeZone`. The offset is
 * read at a first estimate and then again at the result, because a
 * daylight-saving change between the two moves it. 00:05 on the Sunday New
 * Zealand's clocks go forward is still at +12, though that day's UTC midnight
 * is already at +13; reading the offset once put the clock at 23:05 on the
 * Saturday, and a production deploy on 2026-09-25 failed on it.
 */
const localInstant = (
  timeZone: string,
  date: string,
  hours: number,
  minutes: number,
) => {
  const wallClock =
    Date.parse(`${date}T00:00:00Z`) + (hours * 60 + minutes) * 60_000;
  const estimate = wallClock - localOffsetMinutes(timeZone, wallClock) * 60_000;
  return wallClock - localOffsetMinutes(timeZone, estimate) * 60_000;
};

test('the local clock helper holds across daylight-saving changes', () => {
  for (const [timeZone, date, hours, minutes, expected] of [
    // New Zealand moves forward at 02:00 on 2026-09-27.
    ['Pacific/Auckland', '2026-09-27', 0, 5, '2026-09-26T12:05:00.000Z'],
    ['Pacific/Auckland', '2026-09-28', 0, 5, '2026-09-27T11:05:00.000Z'],
    // New Zealand moves back at 03:00 on 2027-04-04.
    ['Pacific/Auckland', '2027-04-04', 0, 5, '2027-04-03T11:05:00.000Z'],
    // Los Angeles moves back at 02:00 on 2026-11-01.
    ['America/Los_Angeles', '2026-10-31', 23, 55, '2026-11-01T06:55:00.000Z'],
    ['America/Los_Angeles', '2026-11-01', 23, 55, '2026-11-02T07:55:00.000Z'],
  ] as const) {
    expect(
      new Date(localInstant(timeZone, date, hours, minutes)).toISOString(),
      `${hours}:${minutes} on ${date} in ${timeZone}`,
    ).toBe(expected);
  }
});

for (const { timeZone, hours, minutes, meal } of [
  // Just after midnight in Auckland: UTC is still on the previous day.
  { timeZone: 'Pacific/Auckland', hours: 0, minutes: 5, meal: 'breakfast' },
  // Just before midnight in Los Angeles: UTC is already on the next day.
  { timeZone: 'America/Los_Angeles', hours: 23, minutes: 55, meal: 'lunch' },
]) {
  test.describe(`on a device in ${timeZone}`, () => {
    test.use({ timezoneId: timeZone });

    test('today and a saved date follow the local calendar day', async ({
      page,
      browser,
    }, testInfo) => {
      const localToday = addDays(isoDate(Date.now()), 2);
      const instant = localInstant(timeZone, localToday, hours, minutes);
      // The UTC date really is a different day from the device's.
      expect(isoDate(instant)).not.toBe(localToday);
      await page.clock.setFixedTime(instant);

      await openPlan(page, '/plan');
      const todayCard = day(page, localToday);
      await expect(todayCard).toHaveAttribute('data-today', 'true');
      await expect(todayCard.getByText('Today', { exact: true })).toBeVisible();

      const title = unique('Midnight snack');
      await todayCard
        .getByRole('button', { name: new RegExp(`^Add to ${meal}`, 'u') })
        .click();
      const dialog = await openedDialog(page);
      await dialog.getByRole('radio', { name: 'Type a meal' }).check();
      await dialog.getByRole('textbox', { name: 'Meal' }).fill(title);
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/meal-plan/entries') &&
          response.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Add to plan' }).click();
      const body = (await (await saved).json()) as { entry: { date: string } };
      expect(body.entry.date).toBe(localToday);
      await expect(slot(page, localToday, meal)).toContainText(title);

      // A member on the other side of the world sees it on the same day.
      const elsewhere = await browser.newContext({
        baseURL: String(testInfo.project.use.baseURL),
        timezoneId:
          timeZone === 'Pacific/Auckland'
            ? 'America/Los_Angeles'
            : 'Pacific/Auckland',
      });
      const other = await elsewhere.newPage();
      await openPlan(other, `/plan/${mondayOf(localToday)}`);
      await expect(slot(other, localToday, meal)).toContainText(title);
      await elsewhere.close();
    });
  });
}
