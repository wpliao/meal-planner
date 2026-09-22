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
test('text meets WCAG AA contrast against its own background', async ({
  page,
}) => {
  await stub(page);

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
