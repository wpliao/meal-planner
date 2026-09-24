import { expect, test, type Page } from '@playwright/test';

/**
 * Visual regression coverage for the surfaces where Phase 2's three styling
 * defects lived. These are the defect classes name-based queries cannot see:
 * colour and contrast, control sizing, and overlap.
 *
 * Every response is mocked and the locale and time zone are pinned, so a
 * snapshot only changes when the interface changes — never because the pantry
 * holds different rows, the date moved on, or the device formats dates
 * differently. The suite therefore needs no database and no bootstrap state.
 */
test.use({ locale: 'en-US', timezoneId: 'UTC' });

const SESSION = {
  status: 'ready',
  member: { id: 'owner-1', email: 'owner@example.test', role: 'owner' },
  household: { id: 'household-1', name: 'Liao family' },
};

const MEMBERS = {
  members: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'owner@example.test',
      role: 'owner',
      status: 'active',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'invitee@example.test',
      role: 'member',
      status: 'invited',
    },
  ],
};

// Fixed timestamps keep "Last changed" stable across runs.
const item = (id: string, name: string, status: string, version = 1) => ({
  id,
  name,
  status,
  version,
  createdAt: '2026-01-15T00:00:00.000Z',
  updatedAt: '2026-01-15T00:00:00.000Z',
});

const ITEMS = {
  items: [
    item('33333333-3333-4333-8333-333333333333', 'bread', 'needed'),
    item('44444444-4444-4444-8444-444444444444', 'olive oil', 'low'),
    item('55555555-5555-4555-8555-555555555555', 'rice', 'available'),
  ],
};

const stub = async (page: Page, path = '/pantry', heading = 'Pantry') => {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(SESSION),
    }),
  );
  await page.route('**/api/household/members', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(MEMBERS),
    }),
  );
  await page.route('**/api/pantry/items', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(ITEMS),
    }),
  );
  await page.goto(path);
  await expect(
    page.getByRole('heading', { name: heading }).first(),
  ).toBeVisible();
};

const pantry = (page: Page) => page.getByRole('region', { name: 'Pantry' });

test('pantry panel', async ({ page }) => {
  await stub(page);
  await expect(pantry(page)).toHaveScreenshot('pantry-panel.png');
});

test('item actions menu', async ({ page }) => {
  await stub(page);
  const card = page.getByTestId('pantry-item').filter({ hasText: 'rice' });
  await card.getByRole('button', { name: 'Actions for rice' }).click();
  // Scoped tightly on purpose. The same fault inside the whole panel changes
  // too few pixels to clear the ratio tolerance; here the affected text is a
  // large share of the area.
  await expect(page.getByRole('menu')).toHaveScreenshot('item-menu.png', {
    maxDiffPixelRatio: 0.005,
  });
});

/**
 * Pixel diffing is a blunt instrument for contrast: unreadable text can be a
 * small share of a region and slip under any tolerance loose enough to absorb
 * font antialiasing. This measures the rendered colours instead, so the check
 * is exact and immune to rendering differences between machines.
 */
const assertTextContrast = async (page: Page) => {
  const failures = await page.evaluate(() => {
    const parse = (value: string): [number, number, number, number] => {
      const n = value.match(/[\d.]+/gu)?.map(Number) ?? [];
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const lum = ([r, g, b]: number[]) => {
      const c = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    // Walk up for the first opaque background actually painted behind the text.
    const backdrop = (el: Element): number[] => {
      let node: Element | null = el;
      while (node) {
        const [r, g, b, a] = parse(getComputedStyle(node).backgroundColor);
        if (a > 0.95) return [r, g, b];
        node = node.parentElement;
      }
      return [255, 255, 255];
    };

    const bad: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll('button, a, label, legend, p, td, th, span'),
    )) {
      const text = (el.textContent ?? '').trim();
      if (!text || el.querySelector('button, a, input')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;

      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.opacity === '0') continue;

      const fg = parse(style.color);
      const [l1, l2] = [lum(fg), lum(backdrop(el))].sort((a, b) => b - a);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 &&
          Number(style.fontWeight) >= 700);

      if (ratio < (large ? 3 : 4.5)) {
        bad.push(`${text.slice(0, 30)} — ${ratio.toFixed(2)}:1`);
      }
    }
    return bad;
  });

  expect(failures, `low-contrast text: ${failures.join(' | ')}`).toEqual([]);
};

test('text meets WCAG AA contrast against its own background', async ({
  page,
}) => {
  await stub(page);
  await assertTextContrast(page);
});

/**
 * Every Mantine component on screen must have its stylesheet loaded.
 *
 * `src/client/mantine.ts` imports Mantine's per-component CSS rather than the
 * whole core sheet, which keeps the CSS at a third of the size and makes two
 * silent failures possible: importing a file in the wrong order, and not
 * importing it at all. Both happened while building this. Neither produced an
 * error, neither failed a behaviour test, and a pixel baseline cannot catch
 * them either — regenerating the baselines simply records the broken
 * rendering as correct.
 *
 * Mantine gives every styled element a hashed `m_…` class. If one is in the
 * DOM with no rule behind it anywhere in the loaded CSS, its stylesheet is
 * missing. `mantine.test.ts` covers ordering; this covers absence.
 */
const assertEveryMantineClassIsStyled = async (page: Page) => {
  const unstyled = await page.evaluate(() => {
    const rules = new Set<string>();
    for (const sheet of Array.from(document.styleSheets)) {
      let cssRules: CSSRuleList;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue; // Cross-origin sheet; nothing of ours lives there.
      }
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          const selector = (rule as CSSStyleRule).selectorText;
          if (selector) {
            for (const match of selector.matchAll(/\.(m_[a-z0-9]+)/gu)) {
              rules.add(match[1]);
            }
          }
          const nested = (rule as CSSGroupingRule).cssRules;
          if (nested) walk(nested);
        }
      };
      walk(cssRules);
    }

    const missing = new Set<string>();
    for (const element of Array.from(document.querySelectorAll('[class]'))) {
      for (const name of Array.from(element.classList)) {
        if (/^m_[a-z0-9]+$/u.test(name) && !rules.has(name)) missing.add(name);
      }
    }
    return Array.from(missing);
  });

  expect(
    unstyled,
    `Mantine classes with no CSS rule — a per-component stylesheet is missing from src/client/mantine.ts: ${unstyled.join(', ')}`,
  ).toEqual([]);
};

test('every Mantine component on the pantry has its stylesheet', async ({
  page,
}) => {
  await stub(page);
  // Open the menu and a rename field so the lazier components render too.
  await page.getByRole('button', { name: 'Actions for rice' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await assertEveryMantineClassIsStyled(page);
});

test('every Mantine component on the family page has its stylesheet', async ({
  page,
}) => {
  await stub(page, '/family', 'Family');
  await assertEveryMantineClassIsStyled(page);
});

test('status control group', async ({ page }) => {
  await stub(page);
  // Catches oversized or overlapping form controls, which WebKit sized very
  // differently from Chromium.
  await expect(page.getByTestId('status-field')).toHaveScreenshot(
    'status-controls.png',
  );
});

test('pantry item with rename open', async ({ page }) => {
  await stub(page);
  // Address the card by position, not by its text: inline renaming replaces
  // the name with an input, whose value hasText cannot see. Order is fixed by
  // the mocked data — needed, then low, then available.
  const card = page.getByTestId('pantry-item').nth(1);
  await expect(card).toContainText('olive oil');
  await card.getByRole('button', { name: 'Actions for olive oil' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  // Catches the rename field collapsing: a layout fault the component layer
  // cannot prevent.
  await expect(card).toHaveScreenshot('pantry-item-rename.png');
});

test('remove confirmation dialog', async ({ page }) => {
  await stub(page);
  await page
    .getByTestId('pantry-item')
    .filter({ hasText: 'rice' })
    .getByRole('button', { name: 'Actions for rice' })
    .click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(page.getByRole('dialog')).toHaveScreenshot('remove-dialog.png');
});

test('members panel', async ({ page }) => {
  await stub(page, '/family', 'Family');
  await expect(
    page.getByRole('complementary', { name: 'Members' }),
  ).toHaveScreenshot('members-panel.png');
});

// ---------------------------------------------------------------------------
// Recipes

const RECIPE_ID = '66666666-6666-4666-8666-666666666666';

const RECIPE = {
  id: RECIPE_ID,
  title: 'Soy-glazed chicken thighs',
  notes: 'Family favourite. Use a cast-iron pan for the glaze.',
  ingredients: [
    '2 tbsp soy sauce',
    '1 tbsp honey',
    '500 g boneless chicken thighs',
  ],
  steps: [
    'Whisk the soy sauce and honey together.',
    'Marinate the chicken for 20 minutes, then grill until cooked through, brushing with the glaze.',
  ],
  source: {
    kind: 'website',
    submittedUrl: 'https://www.justonecookbook.com/soy-chicken/',
    resolvedUrl: null,
    host: 'www.justonecookbook.com',
    pageTitle: 'Soy Chicken',
    importedAt: '2026-01-15T00:00:00.000Z',
  },
  version: 1,
  createdAt: '2026-01-15T00:00:00.000Z',
  updatedAt: '2026-01-15T00:00:00.000Z',
};

const RECIPES = {
  recipes: [
    {
      id: RECIPE_ID,
      title: RECIPE.title,
      source: { kind: 'website', host: 'www.justonecookbook.com' },
      version: 1,
      createdAt: RECIPE.createdAt,
      updatedAt: RECIPE.updatedAt,
    },
    {
      id: '77777777-7777-4777-8777-777777777777',
      title: 'Grandma’s miso soup',
      source: { kind: 'manual' },
      version: 1,
      createdAt: RECIPE.createdAt,
      updatedAt: RECIPE.updatedAt,
    },
  ],
};

const stubRecipes = async (page: Page, path: string, heading: string) => {
  await page.route('**/api/recipes', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(RECIPES),
    }),
  );
  await page.route(`**/api/recipes/${RECIPE_ID}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ recipe: RECIPE }),
    }),
  );
  await stub(page, path, heading);
};

const recipePanel = (page: Page) => page.getByTestId('recipe-panel');

const IMPORT_URL = 'https://www.justonecookbook.com/oyakodon/';

/**
 * The import preview always fails here, and it is answered at the network
 * boundary: a styling check must never depend on a real recipe site, and must
 * never cause a request to one.
 */
const stubImportFailure = (page: Page) =>
  page.route('**/api/recipes/import-preview', (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'import_failed',
          message: 'That page does not publish recipe details.',
        },
        reason: 'unsupported_source',
      }),
    }),
  );

test('recipe library', async ({ page }) => {
  await stubRecipes(page, '/recipes', 'Recipes');
  await expect(page.getByTestId('recipe-item')).toHaveCount(2);
  await expect(recipePanel(page)).toHaveScreenshot('recipe-list.png');
});

test('recipe detail', async ({ page }) => {
  await stubRecipes(page, `/recipes/${RECIPE_ID}`, RECIPE.title);
  await expect(recipePanel(page)).toHaveScreenshot('recipe-detail.png');
});

test('recipe editor', async ({ page }) => {
  await stubRecipes(
    page,
    `/recipes/${RECIPE_ID}/edit`,
    `Edit “${RECIPE.title}”`,
  );
  await expect(page.getByTestId('ingredient-line')).toHaveCount(3);
  // Catches the line controls squeezing the field or overlapping it on a
  // phone, and control sizing in WebKit.
  await expect(recipePanel(page)).toHaveScreenshot('recipe-editor.png');
});

test('recipe screens meet WCAG AA contrast, including field errors', async ({
  page,
}) => {
  await stubRecipes(page, '/recipes', 'Recipes');
  await assertTextContrast(page);

  await page.getByRole('link', { name: RECIPE.title }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: RECIPE.title }),
  ).toBeVisible();
  await assertTextContrast(page);

  await page.goto('/recipes/new');
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(page.getByTestId('form-errors')).toBeVisible();
  await assertTextContrast(page);

  // The import screen, including the failure alert, whose clay colouring is
  // the same one the field errors needed darkening for.
  await stubImportFailure(page);
  await page.goto('/recipes/import');
  await page
    .getByRole('textbox', { name: 'Recipe page link' })
    .fill(IMPORT_URL);
  await assertTextContrast(page);
  await page.getByRole('button', { name: 'Get the recipe' }).click();
  await expect(page.getByTestId('import-failed')).toBeVisible();
  await assertTextContrast(page);
});

test('every Mantine component on the recipe screens has its stylesheet', async ({
  page,
}) => {
  await stubRecipes(page, '/recipes', 'Recipes');
  await assertEveryMantineClassIsStyled(page);

  await page.goto(`/recipes/${RECIPE_ID}`);
  await page.getByRole('button', { name: 'Delete recipe' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await assertEveryMantineClassIsStyled(page);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();

  await page.goto('/recipes/new');
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(page.getByTestId('form-errors')).toBeVisible();
  await assertEveryMantineClassIsStyled(page);

  await stubImportFailure(page);
  await page.goto('/recipes/import');
  await expect(page.getByTestId('import-sites')).toBeVisible();
  await assertEveryMantineClassIsStyled(page);
  await page
    .getByRole('textbox', { name: 'Recipe page link' })
    .fill(IMPORT_URL);
  await page.getByRole('button', { name: 'Get the recipe' }).click();
  await expect(page.getByTestId('import-failed')).toBeVisible();
  await assertEveryMantineClassIsStyled(page);
});

// ---------------------------------------------------------------------------
// Meal plan

/** The device clock for plan snapshots: Thursday 24 September 2026, noon. */
const PLAN_NOW = Date.parse('2026-09-24T12:00:00Z');

const planEntry = (over: Record<string, unknown>) => ({
  id: '88888888-8888-4888-8888-888888888888',
  date: '2026-09-24',
  slot: 'dinner',
  kind: 'text',
  title: 'Leftovers',
  note: null,
  version: 1,
  updatedAt: '2026-01-15T00:00:00.000Z',
  ...over,
});

const PLAN = {
  from: '2026-09-21',
  to: '2026-09-27',
  entries: [
    planEntry({
      id: '88888888-8888-4888-8888-000000000001',
      date: '2026-09-21',
      kind: 'recipe',
      title: RECIPE.title,
      recipeId: RECIPE_ID,
      recipeRemoved: false,
      note: 'double batch',
    }),
    planEntry({
      id: '88888888-8888-4888-8888-000000000002',
      date: '2026-09-23',
      slot: 'lunch',
      kind: 'recipe',
      title: 'Grandma’s old stew',
      recipeId: null,
      recipeRemoved: true,
    }),
    planEntry({ id: '88888888-8888-4888-8888-000000000003' }),
    planEntry({
      id: '88888888-8888-4888-8888-000000000004',
      date: '2026-09-26',
      slot: 'breakfast',
      title: 'Pancakes',
    }),
  ],
};

const stubPlan = async (page: Page, path = '/plan/2026-09-21') => {
  await page.clock.setFixedTime(PLAN_NOW);
  await page.route('**/api/meal-plan?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(PLAN),
    }),
  );
  await stubRecipes(page, path, 'Plan');
  await expect(page.getByTestId('plan-entry')).toHaveCount(4);
};

const planPanel = (page: Page) => page.getByTestId('plan-panel');

test('meal plan week', async ({ page }) => {
  await stubPlan(page);
  // Catches a day card squeezing its meals, the Today marking, and the
  // removed-recipe line on a phone and in WebKit.
  await expect(planPanel(page)).toHaveScreenshot('plan-week.png');
});

test('meal plan add dialog', async ({ page }) => {
  await stubPlan(page);
  await page
    .getByRole('button', { name: 'Add to dinner, Thursday 24 September' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: RECIPE.title })).toBeVisible();
  await expect(dialog).toHaveScreenshot('plan-add-dialog.png');
});

test('meal plan screens meet WCAG AA contrast, including errors and conflicts', async ({
  page,
}) => {
  await stubPlan(page);
  await assertTextContrast(page);

  await page
    .getByRole('button', { name: 'Add to dinner, Thursday 24 September' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Type a meal' }).check();
  await dialog.getByRole('button', { name: 'Add to plan' }).click();
  await expect(dialog.getByText(/between 1 and 120/u)).toBeVisible();
  await assertTextContrast(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // A stale edit shows the conflict panel.
  await page.route('**/api/meal-plan/entries/*', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'stale_version', message: 'Someone else changed it.' },
        current: { ...PLAN.entries[2], note: 'reheat', version: 2 },
      }),
    }),
  );
  await page.getByRole('button', { name: /Actions for Leftovers/u }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const note = page.getByRole('dialog').getByRole('textbox', { name: /Note/u });
  await note.fill('cold');
  await expect(note).toHaveValue('cold');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('entry-conflict')).toBeVisible();
  await assertTextContrast(page);
});

test('every Mantine component on the plan screens has its stylesheet', async ({
  page,
}) => {
  await stubPlan(page);
  await page.getByRole('button', { name: /Actions for Pancakes/u }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await assertEveryMantineClassIsStyled(page);
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await assertEveryMantineClassIsStyled(page);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page
    .getByRole('button', { name: 'Add to lunch, Monday 21 September' })
    .click();
  await expect(
    page.getByRole('dialog').getByRole('radio', { name: RECIPE.title }),
  ).toBeVisible();
  await assertEveryMantineClassIsStyled(page);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.goto(`/recipes/${RECIPE_ID}`);
  await page.getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await assertEveryMantineClassIsStyled(page);
  await assertTextContrast(page);
});
