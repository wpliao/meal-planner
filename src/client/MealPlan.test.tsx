import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MONDAY,
  NOW,
  recipeEntry,
  renderPlan,
  textEntry,
  TODAY,
  week,
} from '../../test/client/meal-plan';
import {
  jsonResponse,
  mockFetch,
  noContent,
  recipe,
  sent,
  summary,
} from '../../test/client/recipes';
import type { MealPlanEntry } from '../shared/meal-plan';

beforeEach(() => {
  // Only the clock is faked; promises and Mantine's transitions run for real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const location = () => screen.getByTestId('location').textContent;
const result = () => screen.getByTestId('plan-result');
const day = (name: string) => screen.getByRole('region', { name });
const THURSDAY = 'Thursday 24 September';
const DINNER_ADD = `Add to dinner, ${THURSDAY}`;

const saved = (entry: MealPlanEntry) => jsonResponse({ entry }, 201);
const stale = (current: MealPlanEntry) =>
  jsonResponse(
    {
      error: { code: 'stale_version', message: 'Someone else changed it.' },
      current,
    },
    409,
  );

const openWeek = async (
  entries: MealPlanEntry[],
  ...then: (() => Promise<Response>)[]
) => {
  const spy = mockFetch(() => jsonResponse(week(entries)), ...then);
  renderPlan([`/plan/${MONDAY}`]);
  await screen.findByTestId('plan-days');
  return spy;
};

/** The recipe field: a searchable combobox whose options open in a portal. */
const recipeField = (dialog: HTMLElement) =>
  within(dialog).findByRole('combobox', { name: 'Recipe' });

const searchRecipes = async (dialog: HTMLElement, search: string) => {
  const input = await recipeField(dialog);
  // Mantine treats a change to an unfocused field as browser autofill and
  // only accepts an exact title, so the field is focused first, as typing
  // would do.
  input.focus();
  fireEvent.click(input);
  fireEvent.change(input, { target: { value: search } });
  return input;
};

const openMenu = async (name: RegExp | string, item: string) => {
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
  return screen.findByRole('dialog');
};

describe('week view', () => {
  it('shows loading, then every day and meal of an empty week', async () => {
    const spy = mockFetch(() => jsonResponse(week([])));
    renderPlan(['/plan']);

    expect(screen.getByText('Checking the plan…')).toBeInTheDocument();
    expect(await screen.findByTestId('plan-empty')).toHaveTextContent(
      'Nothing is planned for this week yet.',
    );
    expect(sent(spy, 0).url).toBe(
      '/api/meal-plan?from=2026-09-21&to=2026-09-27',
    );
    expect(screen.getByTestId('plan-week')).toHaveTextContent(
      '21–27 September 2026',
    );
    const days = screen.getAllByTestId('plan-day');
    expect(days).toHaveLength(7);
    expect(
      days.map((element) => within(element).getByRole('heading').textContent),
    ).toEqual([
      'Monday 21 September',
      'Tuesday 22 September',
      'Wednesday 23 September',
      'Thursday 24 September',
      'Friday 25 September',
      'Saturday 26 September',
      'Sunday 27 September',
    ]);
    // Today is marked in text, on the device's own date.
    expect(within(day(THURSDAY)).getByText('Today')).toBeInTheDocument();
    expect(days.filter((element) => element.dataset.today)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Add to / })).toHaveLength(
      21,
    );
    // `/plan` stays `/plan`: the current week needs no redirect.
    expect(location()).toBe('/plan');
  });

  it('links to the previous, current, and next weeks', async () => {
    mockFetch(
      () => jsonResponse(week([])),
      () => jsonResponse(week([], '2026-09-28')),
    );
    renderPlan([`/plan/${MONDAY}`]);
    await screen.findByTestId('plan-days');

    const nav = screen.getByRole('navigation', { name: 'Weeks' });
    expect(
      within(nav).getByRole('link', { name: 'Previous week' }),
    ).toHaveAttribute('href', '/plan/2026-09-14');
    expect(
      within(nav).getByRole('link', { name: 'This week' }),
    ).toHaveAttribute('aria-current', 'page');
    fireEvent.click(within(nav).getByRole('link', { name: 'Next week' }));

    await waitFor(() => expect(location()).toBe('/plan/2026-09-28'));
    expect(await screen.findByTestId('plan-week')).toHaveTextContent(
      '28 September – 4 October 2026',
    );
    expect(screen.getByRole('link', { name: 'This week' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
  });

  it.each([
    ['a day that is not a Monday', '/plan/2026-09-24', '/plan/2026-09-21'],
    ['an impossible date', '/plan/2026-02-30', '/plan/2026-09-21'],
    ['text that is not a date', '/plan/soon', '/plan/2026-09-21'],
  ])('replaces %s with its week', async (_, path, expected) => {
    mockFetch(() => jsonResponse(week([])));
    renderPlan([path]);
    await waitFor(() => expect(location()).toBe(expected));
    await screen.findByTestId('plan-days');
  });

  it('offers to try again when the plan cannot be loaded', async () => {
    const spy = mockFetch(
      () => jsonResponse({}, 503),
      () => jsonResponse(week([textEntry()])),
    );
    renderPlan([`/plan/${MONDAY}`]);

    expect(
      await screen.findByText('We could not load the plan. Please try again.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Leftovers')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('shows each kind of entry in its meal, as plain text', async () => {
    await openWeek([
      recipeEntry({ slot: 'lunch', note: 'double batch' }),
      recipeEntry({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        title: 'Old stew',
        recipeId: null,
        recipeRemoved: true,
      }),
      textEntry({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        title: '<b>Eat out</b>',
      }),
    ]);

    const thursday = day(THURSDAY);
    const lunch = within(thursday).getByTestId('slot-lunch');
    expect(
      within(lunch).getByRole('link', { name: 'Soy chicken' }),
    ).toHaveAttribute('href', '/recipes/11111111-1111-4111-8111-111111111111');
    expect(lunch).toHaveTextContent('double batch');
    expect(
      within(lunch).getByRole('list', { name: 'Lunch' }),
    ).toBeInTheDocument();

    const dinner = within(thursday).getByTestId('slot-dinner');
    const entries = within(dinner).getAllByTestId('plan-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent(
      'Old stewNo longer in the recipe library',
    );
    expect(within(entries[0]).queryByRole('link')).not.toBeInTheDocument();
    expect(entries[1]).toHaveTextContent('<b>Eat out</b>');
    expect(screen.queryByTestId('plan-empty')).not.toBeInTheDocument();
    expect(
      within(thursday).queryByRole('list', { name: 'Breakfast' }),
    ).not.toBeInTheDocument();
  });

  describe('scrolling to today', () => {
    // jsdom has no layout, so it has no scrollIntoView to spy on.
    const scroll = vi.fn();
    beforeEach(() => {
      scroll.mockReset();
      Element.prototype.scrollIntoView = scroll;
    });
    afterEach(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    it('scrolls to today when the current week opens on a phone', async () => {
      const original = window.matchMedia.bind(window);
      vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
        query === '(max-width: 40em)'
          ? { ...original(query), matches: true }
          : original(query),
      );
      await openWeek([]);
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
      expect(scroll.mock.contexts[0]).toBe(day(THURSDAY));
    });

    it('stays at Monday on a wider screen', async () => {
      await openWeek([]);
      expect(scroll).not.toHaveBeenCalled();
    });
  });
});

describe('adding', () => {
  const openAdd = async (name = DINNER_ADD) => {
    fireEvent.click(screen.getByRole('button', { name }));
    return screen.findByRole('dialog');
  };

  it('adds a typed meal, announces it, and returns focus to Add', async () => {
    const added = textEntry({ title: 'Eat out', note: 'pizza place' });
    const spy = await openWeek(
      [],
      () => jsonResponse({ recipes: [] }),
      () => saved(added),
      () => jsonResponse(week([added])),
    );
    const dialog = await openAdd();
    expect(dialog).toHaveAccessibleName(
      'Add to dinner on Thursday 24 September',
    );

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Type a meal' }));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );
    expect(
      await within(dialog).findByText(
        'Enter a meal between 1 and 120 characters.',
      ),
    ).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Meal' }), {
      target: { value: 'Eat out' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note/u }), {
      target: { value: 'pizza place' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 2)).toEqual({
      url: '/api/meal-plan/entries',
      method: 'POST',
      body: {
        date: TODAY,
        slot: 'dinner',
        note: 'pizza place',
        title: 'Eat out',
      },
    });
    expect(
      await within(result()).findByText(
        'Added “Eat out” to dinner on Thursday 24 September.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('Eat out')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: DINNER_ADD })).toHaveFocus(),
    );
  });

  it('picks a recipe from a filtered list', async () => {
    const added = recipeEntry({ title: 'Miso soup' });
    const spy = await openWeek(
      [],
      () =>
        jsonResponse({
          recipes: [
            summary({
              id: '22222222-2222-4222-8222-222222222222',
              title: 'Soy chicken',
            }),
            summary({
              id: '33333333-3333-4333-8333-333333333333',
              title: 'Miso soup',
            }),
          ],
        }),
      () => saved(added),
      () => jsonResponse(week([added])),
    );
    const dialog = await openAdd();
    const field = await recipeField(dialog);
    expect(field).toHaveAccessibleDescription('Type to search 2 recipes.');

    // Saving with nothing chosen says so next to the field.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );
    expect(
      await within(dialog).findByText('Choose a recipe.'),
    ).toBeInTheDocument();

    // Every typed word must appear in the title, in any order and case.
    await searchRecipes(dialog, 'SOUP miso');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    fireEvent.click(screen.getByRole('option', { name: 'Miso soup' }));
    expect(field).toHaveValue('Miso soup');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 2).body).toEqual({
      date: TODAY,
      slot: 'dinner',
      note: null,
      recipeId: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('says when no recipe matches the search', async () => {
    await openWeek([], () => jsonResponse({ recipes: [summary()] }));
    const dialog = await openAdd();
    expect(await recipeField(dialog)).toHaveAccessibleDescription(
      'Type to search 1 recipe.',
    );
    await searchRecipes(dialog, 'pizza');
    expect(
      await screen.findByText('No recipe matches that search.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('points to Add recipe when the library is empty', async () => {
    await openWeek([], () => jsonResponse({ recipes: [] }));
    const dialog = await openAdd();
    expect(await within(dialog).findByTestId('picker-empty')).toHaveTextContent(
      'The recipe library is empty.',
    );
    expect(
      within(dialog).getByRole('link', { name: 'Add recipe' }),
    ).toHaveAttribute('href', '/recipes/new');
  });

  it('retries loading the recipes', async () => {
    await openWeek(
      [],
      () => jsonResponse({}, 503),
      () => jsonResponse({ recipes: [summary()] }),
    );
    const dialog = await openAdd();
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Retry' }),
    );
    expect(await recipeField(dialog)).toBeInTheDocument();
  });

  it('keeps the typed meal when the meal is full', async () => {
    await openWeek(
      [],
      () => jsonResponse({ recipes: [] }),
      () =>
        jsonResponse(
          {
            error: {
              code: 'limit_reached',
              message:
                'A meal holds at most 6 entries. Remove one or choose another meal.',
            },
          },
          409,
        ),
    );
    const dialog = await openAdd();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Type a meal' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Meal' }), {
      target: { value: 'Seventh dish' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );

    expect(await within(dialog).findByTestId('dialog-error')).toHaveTextContent(
      'A meal holds at most 6 entries.',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Meal' })).toHaveValue(
      'Seventh dish',
    );
  });

  it('reloads the recipes when the chosen one was deleted meanwhile', async () => {
    const spy = await openWeek(
      [],
      () => jsonResponse({ recipes: [summary()] }),
      () =>
        jsonResponse(
          {
            error: {
              code: 'not_found',
              message: 'That recipe no longer exists.',
            },
          },
          404,
        ),
      () => jsonResponse({ recipes: [] }),
    );
    const dialog = await openAdd();
    await searchRecipes(dialog, 'soy');
    fireEvent.click(await screen.findByRole('option', { name: 'Soy chicken' }));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );

    expect(await within(dialog).findByTestId('dialog-error')).toHaveTextContent(
      'That recipe no longer exists.',
    );
    expect(
      await within(dialog).findByTestId('picker-empty'),
    ).toBeInTheDocument();
    expect(sent(spy, 3).url).toBe('/api/recipes');
  });

  it('reports a failed connection and keeps the note', async () => {
    await openWeek(
      [],
      () => jsonResponse({ recipes: [] }),
      () => Promise.reject(new TypeError('Failed to fetch')),
    );
    const dialog = await openAdd();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Type a meal' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Meal' }), {
      target: { value: 'Soup' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note/u }), {
      target: { value: 'n'.repeat(201) },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );
    expect(
      await within(dialog).findByText(
        'Keep the note to 200 characters or fewer.',
      ),
    ).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note/u }), {
      target: { value: 'hot' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );
    expect(await within(dialog).findByTestId('dialog-error')).toHaveTextContent(
      'The meal could not be added. Check your connection and try again.',
    );
    expect(within(dialog).getByRole('textbox', { name: /Note/u })).toHaveValue(
      'hot',
    );
  });

  it('cancels without saving and returns focus to Add', async () => {
    const spy = await openWeek([], () => jsonResponse({ recipes: [] }));
    const dialog = await openAdd(`Add to breakfast, ${THURSDAY}`);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: `Add to breakfast, ${THURSDAY}` }),
    ).toHaveFocus();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('moving', () => {
  const entry = textEntry({ title: 'Curry' });
  const menu = /Actions for Curry/u;

  it('moves to another date and meal, sending only what changed', async () => {
    const moved = {
      ...entry,
      date: '2026-09-25',
      slot: 'lunch' as const,
      version: 2,
    };
    const spy = await openWeek(
      [entry],
      () => jsonResponse({ entry: moved }),
      () => jsonResponse(week([moved])),
    );
    const dialog = await openMenu(menu, 'Move');
    expect(dialog).toHaveAccessibleName('Move “Curry”');
    fireEvent.change(within(dialog).getByLabelText('Date'), {
      target: { value: '2026-09-25' },
    });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Meal' }), {
      target: { value: 'lunch' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 1)).toEqual({
      url: `/api/meal-plan/entries/${entry.id}`,
      method: 'PATCH',
      body: { version: 1, date: '2026-09-25', slot: 'lunch' },
    });
    expect(
      await within(result()).findByText(
        'Moved “Curry” to lunch on Friday 25 September.',
      ),
    ).toBeInTheDocument();
    // The entry left the meal, so focus goes to that meal's Add button.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: DINNER_ADD })).toHaveFocus(),
    );
  });

  it('closes without a request when nothing changed', async () => {
    const spy = await openWeek([entry]);
    const dialog = await openMenu(menu, 'Move');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: menu })).toHaveFocus();
  });

  it('refuses a date outside the write window next to the field', async () => {
    const spy = await openWeek([entry]);
    const dialog = await openMenu(menu, 'Move');
    fireEvent.change(within(dialog).getByLabelText('Date'), {
      target: { value: '2030-01-01' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(
      await within(dialog).findByText(/52 weeks ahead/u),
    ).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Date'), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(
      await within(dialog).findByText('Choose a date.'),
    ).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shows a newer change and can move that version instead', async () => {
    const latest = { ...entry, note: 'mild', version: 2 };
    const moved = { ...latest, slot: 'lunch' as const, version: 3 };
    const spy = await openWeek(
      [entry],
      () => stale(latest),
      () => jsonResponse({ entry: moved }),
      () => jsonResponse(week([moved])),
    );
    const dialog = await openMenu(menu, 'Move');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Meal' }), {
      target: { value: 'lunch' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

    const conflict = await within(dialog).findByTestId('entry-conflict');
    expect(conflict).toHaveTextContent(
      'It is now “Curry” (mild), dinner on Thursday 24 September.',
    );
    fireEvent.click(
      within(conflict).getByRole('button', { name: 'Move the latest version' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 2).body).toEqual({ version: 2, slot: 'lunch' });
  });

  it('keeps the newer version when asked', async () => {
    const latest = { ...entry, date: '2026-09-26', version: 2 };
    await openWeek(
      [entry],
      () => stale(latest),
      () => jsonResponse(week([latest])),
    );
    const dialog = await openMenu(menu, 'Move');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Meal' }), {
      target: { value: 'breakfast' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    fireEvent.click(
      await within(dialog).findByRole('button', {
        name: 'Keep it where it is',
      }),
    );
    expect(
      await within(result()).findByText(
        'The entry was left as the other member saved it.',
      ),
    ).toBeInTheDocument();
  });

  it('reports a connection failure in the dialog', async () => {
    await openWeek([entry], () => Promise.reject(new TypeError('offline')));
    const dialog = await openMenu(menu, 'Move');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Meal' }), {
      target: { value: 'lunch' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(await within(dialog).findByTestId('dialog-error')).toHaveTextContent(
      'The meal could not be moved.',
    );
  });
});

describe('editing', () => {
  it('changes a typed meal and clears its note', async () => {
    const entry = textEntry({ title: 'Curry', note: 'mild' });
    const edited = { ...entry, title: 'Green curry', note: null, version: 2 };
    const spy = await openWeek(
      [entry],
      () => jsonResponse({ entry: edited }),
      () => jsonResponse(week([edited])),
    );
    const dialog = await openMenu(/Actions for Curry/u, 'Edit');
    const meal = within(dialog).getByRole('textbox', { name: 'Meal' });
    fireEvent.change(meal, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText(/between 1 and 120/u),
    ).toBeInTheDocument();

    fireEvent.change(meal, { target: { value: ' Green  curry ' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note/u }), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 1).body).toEqual({
      version: 1,
      title: 'Green curry',
      note: null,
    });
    expect(
      await within(result()).findByText('Your changes to the meal were saved.'),
    ).toBeInTheDocument();
    // The entry stayed, so focus returns to its own actions button.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Actions for Green curry/u }),
      ).toHaveFocus(),
    );
  });

  it("edits only a planned recipe's note", async () => {
    const entry = recipeEntry();
    const spy = await openWeek(
      [entry],
      () =>
        jsonResponse({ entry: { ...entry, note: 'extra rice', version: 2 } }),
      () => jsonResponse(week([{ ...entry, note: 'extra rice', version: 2 }])),
    );
    const dialog = await openMenu(/Actions for Soy chicken/u, 'Edit');
    expect(
      within(dialog).queryByRole('textbox', { name: 'Meal' }),
    ).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('Edit the recipe to change it.');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note/u }), {
      target: { value: 'extra rice' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 1).body).toEqual({ version: 1, note: 'extra rice' });
  });

  it('closes without a request when nothing changed', async () => {
    const spy = await openWeek([textEntry()]);
    const dialog = await openMenu(/Actions for Leftovers/u, 'Edit');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('applies the change to the latest version after a conflict', async () => {
    const entry = textEntry({ title: 'Curry' });
    const latest = { ...entry, slot: 'lunch' as const, version: 4 };
    const spy = await openWeek(
      [entry],
      () => stale(latest),
      () => jsonResponse({ entry: { ...latest, note: 'hot', version: 5 } }),
      () => jsonResponse(week([{ ...latest, note: 'hot', version: 5 }])),
    );
    const dialog = await openMenu(/Actions for Curry/u, 'Edit');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note/u }), {
      target: { value: 'hot' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const conflict = await within(dialog).findByTestId('entry-conflict');
    expect(conflict).toHaveTextContent('lunch on Thursday 24 September');
    // What the member typed is still there.
    expect(within(dialog).getByRole('textbox', { name: /Note/u })).toHaveValue(
      'hot',
    );
    fireEvent.click(
      within(conflict).getByRole('button', {
        name: 'Apply my change to the latest version',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 2).body).toEqual({ version: 4, note: 'hot' });
  });
});

describe('removing', () => {
  const entry = textEntry({ title: 'Curry' });
  const menu = /Actions for Curry/u;

  it('removes after a named confirmation', async () => {
    const spy = await openWeek(
      [entry],
      () => noContent(),
      () => jsonResponse(week([])),
    );
    const dialog = await openMenu(menu, 'Remove');
    expect(dialog).toHaveAccessibleName('Remove “Curry”?');
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 1)).toEqual({
      url: `/api/meal-plan/entries/${entry.id}`,
      method: 'DELETE',
      body: { version: 1 },
    });
    expect(
      await within(result()).findByText(
        'Removed “Curry” from dinner on Thursday 24 September.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: DINNER_ADD })).toHaveFocus(),
    );
  });

  it('keeps a newer version and can remove it on request', async () => {
    const latest = { ...entry, note: 'mild', version: 2 };
    const spy = await openWeek(
      [entry],
      () => stale(latest),
      () => noContent(),
      () => jsonResponse(week([])),
    );
    const dialog = await openMenu(menu, 'Remove');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    const conflict = await within(dialog).findByTestId('entry-conflict');
    expect(conflict).toHaveTextContent('It was not removed.');
    fireEvent.click(
      within(conflict).getByRole('button', {
        name: 'Remove the latest version',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 2).body).toEqual({ version: 2 });
  });

  it('keeps it when asked after a conflict', async () => {
    await openWeek(
      [entry],
      () => stale({ ...entry, version: 2 }),
      () => jsonResponse(week([{ ...entry, version: 2 }])),
    );
    const dialog = await openMenu(menu, 'Remove');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Keep it' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Curry')).toBeInTheDocument();
  });

  it('reports an entry someone else already removed', async () => {
    await openWeek(
      [entry],
      () =>
        jsonResponse(
          {
            error: {
              code: 'not_found',
              message: 'That plan entry no longer exists.',
            },
          },
          404,
        ),
      () => jsonResponse(week([])),
    );
    const dialog = await openMenu(menu, 'Remove');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(
      await within(result()).findByText(
        'That entry had already been removed by someone else.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('plan-empty')).toBeInTheDocument();
  });

  it('cancels with Escape and returns focus to the actions button', async () => {
    const spy = await openWeek([entry]);
    const dialog = await openMenu(menu, 'Remove');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: menu })).toHaveFocus();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('clearing a week', () => {
  const LAST_WEEK = '2026-09-14';
  const HEADING = '14–20 September 2026';
  const CLEAR = `Clear this week, ${HEADING}`;
  const curry = textEntry({ title: 'Curry', date: LAST_WEEK });
  const soup = textEntry({
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    title: 'Soup',
    date: '2026-09-20',
    slot: 'lunch',
    version: 3,
  });
  const weekChanged = (current: MealPlanEntry[]) =>
    jsonResponse(
      {
        error: { code: 'week_changed', message: 'This week changed.' },
        current,
      },
      409,
    );

  const openPast = async (
    entries: MealPlanEntry[],
    ...then: (() => Promise<Response>)[]
  ) => {
    const spy = mockFetch(
      () => jsonResponse(week(entries, LAST_WEEK)),
      ...then,
    );
    renderPlan([`/plan/${LAST_WEEK}`]);
    await screen.findByTestId('plan-days');
    return spy;
  };

  const openClear = async () => {
    fireEvent.click(screen.getByRole('button', { name: CLEAR }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    return dialog;
  };

  it('is offered only on a past week that has planned meals', async () => {
    mockFetch(
      () => jsonResponse(week([textEntry()])),
      () => jsonResponse(week([], LAST_WEEK)),
    );
    renderPlan([`/plan/${MONDAY}`]);
    await screen.findByTestId('plan-days');
    expect(
      screen.queryByRole('button', { name: /^Clear this week/u }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Previous week' }));
    expect(await screen.findByTestId('plan-empty')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Clear this week/u }),
    ).not.toBeInTheDocument();
  });

  it('clears after a confirmation that names the week and count, then focuses the heading', async () => {
    const spy = await openPast(
      [curry, soup],
      () => noContent(),
      () => jsonResponse(week([], LAST_WEEK)),
    );
    const button = screen.getByRole('button', { name: CLEAR });
    expect(button).toHaveTextContent('Clear this week');

    const dialog = await openClear();
    expect(dialog).toHaveAccessibleName(`Clear ${HEADING}?`);
    expect(dialog).toHaveTextContent(
      'This removes all 2 planned meals in this week for everyone. It cannot be undone.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear week' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 1)).toEqual({
      url: `/api/meal-plan/weeks/${LAST_WEEK}`,
      method: 'DELETE',
      body: {
        entries: [
          { id: curry.id, version: 1 },
          { id: soup.id, version: 3 },
        ],
      },
    });
    expect(
      await within(result()).findByText(
        `Cleared 2 planned meals from ${HEADING}.`,
      ),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('plan-empty')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: CLEAR }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('plan-week')).toHaveFocus());
  });

  it('names a single planned meal', async () => {
    await openPast([curry]);
    const dialog = await openClear();
    expect(dialog).toHaveTextContent(
      'This removes the 1 planned meal in this week for everyone.',
    );
  });

  it('cancels without a request and returns focus to Clear', async () => {
    const spy = await openPast([curry]);
    let dialog = await openClear();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: CLEAR })).toHaveFocus();

    dialog = await openClear();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: CLEAR })).toHaveFocus();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shows the new count after the week changed, and clears that version on request', async () => {
    const edited = { ...curry, note: 'mild', version: 2 };
    const latest = [edited, soup];
    const spy = await openPast(
      [curry, soup],
      () => weekChanged(latest),
      () => jsonResponse(week(latest, LAST_WEEK)),
      () => noContent(),
      () => jsonResponse(week([], LAST_WEEK)),
    );
    const dialog = await openClear();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear week' }));

    const conflict = await within(dialog).findByTestId('week-conflict');
    expect(conflict).toHaveTextContent(
      'This week changed after you opened it, so nothing was removed. It now has 2 planned meals.',
    );
    expect(
      within(dialog).queryByRole('button', { name: 'Clear week' }),
    ).not.toBeInTheDocument();
    // The week behind the dialog was read again.
    await waitFor(() => expect(sent(spy, 2).method).toBe('GET'));
    expect(await screen.findByText('mild')).toBeInTheDocument();

    fireEvent.click(
      within(conflict).getByRole('button', { name: 'Clear all 2' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 3).body).toEqual({
      entries: [
        { id: curry.id, version: 2 },
        { id: soup.id, version: 3 },
      ],
    });
    expect(
      await within(result()).findByText(
        `Cleared 2 planned meals from ${HEADING}.`,
      ),
    ).toBeInTheDocument();
  });

  it('offers to clear a single remaining meal after a conflict', async () => {
    await openPast(
      [curry, soup],
      () => weekChanged([soup]),
      () => jsonResponse(week([soup], LAST_WEEK)),
    );
    const dialog = await openClear();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear week' }));
    const conflict = await within(dialog).findByTestId('week-conflict');
    expect(conflict).toHaveTextContent('It now has 1 planned meal.');
    expect(dialog).toHaveTextContent('This removes the 1 planned meal');
    expect(
      within(conflict).getByRole('button', {
        name: 'Clear the 1 planned meal',
      }),
    ).toBeInTheDocument();
  });

  it('keeps the week when asked and returns focus to Clear', async () => {
    const latest = [
      curry,
      soup,
      textEntry({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        title: 'Late',
        date: LAST_WEEK,
      }),
    ];
    await openPast(
      [curry, soup],
      () => weekChanged(latest),
      () => jsonResponse(week(latest, LAST_WEEK)),
      () => jsonResponse(week(latest, LAST_WEEK)),
    );
    const dialog = await openClear();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear week' }));
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Keep them' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      await within(result()).findByText('The week was left as it is now.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: CLEAR })).toHaveFocus(),
    );
    expect(screen.getByText('Late')).toBeInTheDocument();
  });

  it('reports a week someone else already cleared', async () => {
    await openPast(
      [curry],
      () => weekChanged([]),
      () => jsonResponse(week([], LAST_WEEK)),
    );
    const dialog = await openClear();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear week' }));
    expect(
      await within(result()).findByText('This week had already been cleared.'),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('plan-empty')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('plan-week')).toHaveFocus());
  });

  it.each([
    [
      'a failed connection',
      () => Promise.reject(new TypeError('offline')),
      'The week could not be cleared. Check your connection and try again.',
    ],
    [
      'a refusal from the Worker',
      () =>
        jsonResponse(
          {
            error: {
              code: 'invalid_request',
              message: 'Only a week that has ended can be cleared.',
            },
          },
          400,
        ),
      'Only a week that has ended can be cleared.',
    ],
  ])('keeps the dialog open and explains %s', async (_, failure, message) => {
    await openPast([curry], failure);
    const dialog = await openClear();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear week' }));
    expect(await within(dialog).findByTestId('dialog-error')).toHaveTextContent(
      message,
    );
    expect(
      within(dialog).getByRole('button', { name: 'Clear week' }),
    ).toBeEnabled();
    expect(screen.getByText('Curry')).toBeInTheDocument();
  });
});

describe('the near-limit hint', () => {
  const openWith = async (usage: {
    entries: number;
    oldestDate?: string | null;
  }) => {
    mockFetch(() =>
      jsonResponse(week([], MONDAY, { oldestDate: '2023-03-08', ...usage })),
    );
    renderPlan([`/plan/${MONDAY}`]);
    await screen.findByTestId('plan-days');
  };

  it('stays hidden below 3,600 planned meals', async () => {
    await openWith({ entries: 3599 });
    expect(screen.queryByTestId('plan-usage')).not.toBeInTheDocument();
  });

  it('says how full the plan is from 3,600, with a link to the oldest week', async () => {
    await openWith({ entries: 3600 });
    const hint = screen.getByTestId('plan-usage');
    expect(hint).toHaveTextContent(
      'The plan holds 3,600 of 4,000 planned meals. Clear old weeks to make room for new plans.',
    );
    expect(
      within(hint).getByRole('link', { name: 'Go to the oldest planned week' }),
    ).toHaveAttribute('href', '/plan/2023-03-06');
  });

  it('says when the plan is full', async () => {
    await openWith({ entries: 4000 });
    expect(screen.getByTestId('plan-usage')).toHaveTextContent(
      'The plan is full: 4,000 of 4,000 planned meals. Clear old weeks before adding more.',
    );
  });

  it('leaves out the link on the oldest week itself', async () => {
    await openWith({ entries: 3700, oldestDate: '2026-09-23' });
    expect(screen.getByTestId('plan-usage')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Go to the oldest planned week' }),
    ).not.toBeInTheDocument();
  });

  it('leaves out the link when the oldest date is missing', async () => {
    await openWith({ entries: 3700, oldestDate: null });
    expect(
      screen.queryByRole('link', { name: 'Go to the oldest planned week' }),
    ).not.toBeInTheDocument();
  });
});

describe('Add to plan on a recipe', () => {
  const RECIPE_PATH = '/recipes/11111111-1111-4111-8111-111111111111';

  const openRecipe = async (...then: (() => Promise<Response>)[]) => {
    const spy = mockFetch(() => jsonResponse({ recipe: recipe() }), ...then);
    renderPlan([RECIPE_PATH]);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to plan' }));
    const dialog = await screen.findByRole('dialog');
    return { spy, dialog };
  };

  it('plans the recipe for tonight by default and links to that week', async () => {
    const { spy, dialog } = await openRecipe(() =>
      saved(recipeEntry({ date: '2026-09-29' })),
    );
    expect(dialog).toHaveAccessibleName('Add “Soy chicken” to the plan');
    expect(within(dialog).getByLabelText('Date')).toHaveValue(TODAY);
    expect(within(dialog).getByRole('combobox', { name: 'Meal' })).toHaveValue(
      'dinner',
    );
    fireEvent.change(within(dialog).getByLabelText('Date'), {
      target: { value: '2026-09-29' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );

    expect(await within(dialog).findByTestId('plan-added')).toHaveTextContent(
      'Planned for dinner on Tuesday 29 September.',
    );
    expect(sent(spy, 1).body).toEqual({
      date: '2026-09-29',
      slot: 'dinner',
      recipeId: '11111111-1111-4111-8111-111111111111',
      note: null,
    });
    fireEvent.click(
      within(dialog).getByRole('link', {
        name: 'Open the week of Monday 28 September',
      }),
    );
    await waitFor(() => expect(location()).toBe('/plan/2026-09-28'));
  });

  it('refuses a date outside the window and reports a failed save', async () => {
    const { dialog } = await openRecipe(() =>
      jsonResponse(
        {
          error: {
            code: 'not_found',
            message: 'That recipe no longer exists.',
          },
        },
        404,
      ),
    );
    fireEvent.change(within(dialog).getByLabelText('Date'), {
      target: { value: '2020-01-01' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );
    expect(
      await within(dialog).findByText(/8 weeks back/u),
    ).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Date'), {
      target: { value: TODAY },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );
    expect(await within(dialog).findByTestId('dialog-error')).toHaveTextContent(
      'That recipe no longer exists.',
    );
  });

  it('closes on Done and returns focus to Add to plan', async () => {
    const { dialog } = await openRecipe(() => saved(recipeEntry()));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Done' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Add to plan' })).toHaveFocus();
  });

  it('reports a failed connection', async () => {
    const { dialog } = await openRecipe(() =>
      Promise.reject(new TypeError('offline')),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );
    expect(await within(dialog).findByTestId('dialog-error')).toHaveTextContent(
      'The recipe could not be added to the plan.',
    );
  });
});

describe('closing without a change', () => {
  const entry = textEntry({ title: 'Curry' });
  const menu = /Actions for Curry/u;

  it.each(['Move', 'Edit', 'Remove'])(
    'cancels %s and returns focus to the actions button',
    async (item) => {
      const spy = await openWeek([entry]);
      const dialog = await openMenu(menu, item);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('button', { name: menu })).toHaveFocus();
      expect(spy).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['Move', 'Edit'])('closes %s on Escape', async (item) => {
    await openWeek([entry]);
    const dialog = await openMenu(menu, item);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('closes Add on Escape, and switching back to a recipe keeps the picker', async () => {
    await openWeek(
      [],
      () => jsonResponse({ recipes: [summary()] }),
      () => jsonResponse({ recipes: [summary()] }),
    );
    fireEvent.click(screen.getByRole('button', { name: DINNER_ADD }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Type a meal' }));
    fireEvent.click(
      within(dialog).getByRole('radio', { name: 'Pick a recipe' }),
    );
    expect(await recipeField(dialog)).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: DINNER_ADD })).toHaveFocus();
  });

  it('keeps the latest version after an edit conflict', async () => {
    await openWeek(
      [entry],
      () => stale({ ...entry, note: 'mild', version: 2 }),
      () => jsonResponse(week([{ ...entry, note: 'mild', version: 2 }])),
    );
    const dialog = await openMenu(menu, 'Edit');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note/u }), {
      target: { value: 'hot' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    fireEvent.click(
      await within(dialog).findByRole('button', {
        name: 'Keep the latest version',
      }),
    );
    expect(
      await within(result()).findByText(
        'The entry was left as the other member saved it.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('mild')).toBeInTheDocument();
  });

  it('marks a note that is too long when editing', async () => {
    const spy = await openWeek([entry]);
    const dialog = await openMenu(menu, 'Edit');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note/u }), {
      target: { value: 'n'.repeat(201) },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText(
        'Keep the note to 200 characters or fewer.',
      ),
    ).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('moves only the date when the meal stays the same', async () => {
    const moved = { ...entry, date: '2026-09-25', version: 2 };
    const spy = await openWeek(
      [entry],
      () => jsonResponse({ entry: moved }),
      () => jsonResponse(week([moved])),
    );
    const dialog = await openMenu(menu, 'Move');
    fireEvent.change(within(dialog).getByLabelText('Date'), {
      target: { value: '2026-09-25' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(sent(spy, 1).body).toEqual({ version: 1, date: '2026-09-25' });
  });

  it('cancels Add to plan and checks its note', async () => {
    const spy = mockFetch(() => jsonResponse({ recipe: recipe() }));
    renderPlan(['/recipes/11111111-1111-4111-8111-111111111111']);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to plan' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Note/u }), {
      target: { value: 'n'.repeat(201) },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add to plan' }),
    );
    expect(
      await within(dialog).findByText(
        'Keep the note to 200 characters or fewer.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Add to plan' })).toHaveFocus();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
