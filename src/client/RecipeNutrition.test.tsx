import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  jsonResponse,
  mockFetch,
  RECIPE_ID,
  recipe,
  renderRecipes,
  sent,
  staleVersion,
} from '../../test/client/recipes';
import { setRecipeFlash } from './recipe-client';
import {
  NUTRIENT_KEYS,
  type FoodChoice,
  type NutrientAmount,
  type NutrientKey,
  type NutritionLine,
  type RecipeNutrition,
} from '../shared/nutrition';
import type { Recipe } from '../shared/recipes';

afterEach(() => {
  vi.restoreAllMocks();
  setRecipeFlash(null);
});

const detailPath = `/recipes/${RECIPE_ID}`;
const nutritionUrl = `/api/recipes/${RECIPE_ID}/nutrition`;

const SOY: FoodChoice = {
  fdcId: 174278,
  name: 'Soy sauce made from soy (tamari)',
  category: 'Legumes and Legume Products',
  dataType: 'sr_legacy',
  portions: [
    { seq: 1, amount: 1, label: 'tbsp', gramWeight: 18 },
    { seq: 2, amount: 1, label: 'tsp', gramWeight: 6 },
  ],
  volumeSeq: 1,
};

const CHICKEN: FoodChoice = {
  fdcId: 171077,
  name: 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw',
  category: 'Poultry Products',
  dataType: 'sr_legacy',
  portions: [],
  volumeSeq: null,
};

const LINES = ['2 tbsp soy sauce', '500 g chicken'];

const unchecked = (lines = LINES): NutritionLine[] =>
  lines.map((text, index) => ({
    position: index + 1,
    text,
    state: 'unchecked',
    match: null,
  }));

const amount = (value: number | null, missingFrom: string[] = []) => ({
  value,
  missingFrom,
});

const totals = (
  over: Partial<Record<NutrientKey, NutrientAmount>> = {},
): Record<NutrientKey, NutrientAmount> => ({
  energyKj: amount(3212.4),
  proteinG: amount(119.4),
  fatG: amount(13.5),
  saturatedFatG: amount(3.1),
  carbohydrateG: amount(2.03),
  sugarsG: amount(0.62, ['Chicken, breast']),
  fibreG: amount(0.29),
  sodiumMg: amount(2359.9),
  ...over,
});

const perServing = (servings: number) =>
  Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, (totals()[key].value ?? 0) / servings]),
  ) as Record<NutrientKey, number>;

const NOT_WORKED_OUT: RecipeNutrition = {
  recipeVersion: 1,
  servings: null,
  lines: unchecked(),
  checked: false,
  needsCheck: 0,
  counted: 0,
  totals: null,
  perServing: null,
  sources: [],
};

const countedLines = (): NutritionLine[] => [
  {
    position: 1,
    text: LINES[0],
    state: 'counted',
    match: {
      food: SOY,
      quantity: 2,
      unit: 'tbsp',
      unitLabel: 'tbsp',
      grams: 36.5,
    },
  },
  { position: 2, text: LINES[1], state: 'not_counted', match: null },
];

const WORKED_OUT: RecipeNutrition = {
  recipeVersion: 1,
  servings: 4,
  lines: countedLines(),
  checked: true,
  needsCheck: 0,
  counted: 1,
  totals: totals(),
  perServing: perServing(4),
  sources: [
    {
      fdcId: SOY.fdcId,
      name: SOY.name,
      dataType: 'sr_legacy',
      release: '2018-04',
      url: `https://fdc.nal.usda.gov/food-details/${SOY.fdcId}/nutrients`,
    },
  ],
};

const detail = (nutrition: RecipeNutrition, over: Partial<Recipe> = {}) =>
  jsonResponse({
    recipe: recipe({ ingredients: LINES, ...over }),
    preferences: { favourite: false, notNowUntil: null },
    nutrition,
  });

const section = () => screen.findByTestId('recipe-nutrition');

const openReview = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name }));
  return screen.findByRole('dialog', { name: 'Check the matches' });
};

const card = (dialog: HTMLElement, legend: string) =>
  within(dialog).getByRole('group', { name: legend });

describe('Recipe nutrition', () => {
  it('offers to work out nutrition before any match is saved', async () => {
    mockFetch(() => detail(NOT_WORKED_OUT));
    renderRecipes([detailPath]);
    const nutrition = within(await section());
    expect(
      nutrition.getByText('Nutrition hasn’t been worked out for this recipe.'),
    ).toBeInTheDocument();
    expect(
      nutrition.getByRole('button', { name: 'Work out nutrition' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('nutrition-panel')).not.toBeInTheDocument();
  });

  it('shows the label panel per serving and for the whole recipe', async () => {
    mockFetch(() => detail(WORKED_OUT, { servings: 4 }));
    renderRecipes([detailPath]);
    await section();
    // Once under the title, once in the panel's per-serving heading.
    expect(screen.getAllByText('Serves 4')).toHaveLength(2);
    const panel = screen.getByTestId('nutrition-panel');
    const headers = within(panel)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      'Nutrient',
      'Per servingServes 4',
      'Whole recipe',
    ]);
    const energy = within(panel).getByRole('row', { name: /^Energy/u });
    expect(energy).toHaveTextContent('803 kJ (192 kcal)');
    expect(energy).toHaveTextContent('3,212 kJ (768 kcal)');
    const sugars = within(panel).getByRole('row', { name: /^Sugars/u });
    expect(sugars).toHaveTextContent('0.6 g † (incomplete)');
    expect(screen.getByTestId('nutrition-missing')).toHaveTextContent(
      'Sugars: no value for 1 food (Chicken, breast).',
    );
    expect(screen.getByTestId('nutrition-coverage')).toHaveTextContent(
      '1 of 2 ingredients counted.',
    );
    expect(screen.getByText('Not counted: 500 g chicken.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Estimated from USDA FoodData Central. Not dietary advice.',
      ),
    ).toBeInTheDocument();
    const sources = screen.getByTestId('nutrition-sources');
    fireEvent.click(within(sources).getByText('Sources (1)'));
    expect(sources).toHaveAttribute('open');
    const source = within(sources).getByRole('link', {
      name: `${SOY.name} (opens in a new tab)`,
    });
    expect(source).toHaveAttribute(
      'href',
      'https://fdc.nal.usda.gov/food-details/174278/nutrients',
    );
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows only the whole recipe without servings, and asks for them', async () => {
    mockFetch(() =>
      detail({ ...WORKED_OUT, servings: null, perServing: null }),
    );
    renderRecipes([detailPath]);
    await section();
    const headers = within(screen.getByTestId('nutrition-panel'))
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['Nutrient', 'Whole recipe']);
    expect(
      screen.getByText('Add servings to see values per serving.', {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('recipe-nutrition')).getByRole('link', {
        name: 'Edit recipe',
      }),
    ).toHaveAttribute('href', `${detailPath}/edit`);
  });

  it('says which lines changed and checks only those', async () => {
    const changed: RecipeNutrition = {
      ...WORKED_OUT,
      lines: [
        countedLines()[0],
        { position: 2, text: '600 g chicken', state: 'changed', match: null },
      ],
      needsCheck: 1,
    };
    mockFetch(() => detail(changed));
    renderRecipes([detailPath]);
    expect(await screen.findByTestId('nutrition-changed')).toHaveTextContent(
      '1 ingredient changed since nutrition was checked. It isn’t counted.',
    );
    const dialog = await openReview('Check changed lines');
    expect(within(dialog).getAllByTestId('review-line')).toHaveLength(1);
    expect(card(dialog, '600 g chicken')).toBeInTheDocument();
    expect(
      within(dialog).getByText('1 other ingredient is already checked.', {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  describe('checking the matches', () => {
    const searchFor = (dialog: HTMLElement, legend: string, query: string) => {
      fireEvent.change(
        within(card(dialog, legend)).getByRole('textbox', {
          name: 'Search foods',
        }),
        { target: { value: query } },
      );
    };

    it('saves a chosen food and amount, and a line not counted', async () => {
      const saved: RecipeNutrition = {
        ...WORKED_OUT,
        servings: null,
        perServing: null,
      };
      const fetchMock = mockFetch(
        () => detail(NOT_WORKED_OUT),
        () => jsonResponse({ foods: [SOY] }),
        () => jsonResponse({ nutrition: saved }),
      );
      renderRecipes([detailPath]);
      const dialog = await openReview('Work out nutrition');
      const save = within(dialog).getByRole('button', { name: 'Save matches' });
      const left = within(dialog).getByText(
        '2 left: choose a food and amount, or “Don’t count”.',
      );
      // Save stays enabled; with lines left it points to the first of them.
      fireEvent.click(save);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(
        within(card(dialog, LINES[0])).getByRole('textbox', {
          name: 'Search foods',
        }),
      ).toHaveFocus();
      expect(save).toHaveAccessibleDescription(left.textContent ?? '');

      searchFor(dialog, LINES[0], 'soy sauce');
      fireEvent.click(
        await within(card(dialog, LINES[0])).findByRole('button', {
          name: /^Soy sauce made from soy/u,
        }),
      );
      const soyCard = within(card(dialog, LINES[0]));
      await waitFor(() =>
        expect(soyCard.getByRole('textbox', { name: 'Amount' })).toHaveFocus(),
      );
      expect(soyCard.getByText('Enter an amount.')).toBeInTheDocument();
      fireEvent.change(soyCard.getByRole('textbox', { name: 'Amount' }), {
        target: { value: '2' },
      });
      fireEvent.change(soyCard.getByRole('combobox', { name: 'Unit' }), {
        target: { value: 'tbsp' },
      });
      expect(soyCard.getByTestId('review-grams')).toHaveTextContent('= 36.5 g');

      fireEvent.click(
        within(card(dialog, LINES[1])).getByRole('checkbox', {
          name: 'Don’t count',
        }),
      );
      expect(save).toBeEnabled();
      fireEvent.click(save);

      expect(await screen.findByText('Nutrition saved.')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Nutrition' })).toHaveFocus();
      expect(sent(fetchMock, 1).url).toBe('/api/nutrition/foods?q=soy%20sauce');
      expect(sent(fetchMock, 2)).toEqual({
        url: nutritionUrl,
        method: 'PUT',
        body: {
          recipeVersion: 1,
          matches: [
            {
              position: 1,
              line: LINES[0],
              fdcId: SOY.fdcId,
              quantity: 2,
              unit: 'tbsp',
            },
            { position: 2, line: LINES[1], fdcId: null },
          ],
        },
      });
      expect(screen.getByTestId('nutrition-panel')).toBeInTheDocument();
    });

    it('offers only the units a food can use, and explains an amount it cannot', async () => {
      mockFetch(
        () => detail(NOT_WORKED_OUT),
        () => jsonResponse({ foods: [CHICKEN] }),
      );
      renderRecipes([detailPath]);
      const dialog = await openReview('Work out nutrition');
      searchFor(dialog, LINES[1], 'chicken breast');
      fireEvent.click(
        await within(card(dialog, LINES[1])).findByRole('button', {
          name: /^Chicken, broiler/u,
        }),
      );
      const chicken = within(card(dialog, LINES[1]));
      const units = within(chicken.getByRole('combobox', { name: 'Unit' }))
        .getAllByRole('option')
        .map((option) => option.textContent);
      // No volume for raw chicken breast in USDA, so no cups.
      expect(units).toEqual(['g', 'kg']);
      fireEvent.change(chicken.getByRole('textbox', { name: 'Amount' }), {
        target: { value: 'half' },
      });
      expect(chicken.getByTestId('review-grams')).toHaveTextContent(
        'Enter a number above 0 and up to 10,000, such as 2 or 1.5.',
      );
      fireEvent.change(chicken.getByRole('textbox', { name: 'Amount' }), {
        target: { value: '11' },
      });
      fireEvent.change(chicken.getByRole('combobox', { name: 'Unit' }), {
        target: { value: 'kg' },
      });
      expect(chicken.getByTestId('review-grams')).toHaveTextContent(
        'That’s over 10,000 g.',
      );
    });

    it('prefills saved matches, and changes a food', async () => {
      mockFetch(
        () => detail(WORKED_OUT),
        () => jsonResponse({ foods: [] }),
      );
      renderRecipes([detailPath]);
      const dialog = await openReview('Edit matches');
      const soyCard = within(card(dialog, LINES[0]));
      expect(soyCard.getByText(SOY.name)).toBeInTheDocument();
      expect(soyCard.getByRole('textbox', { name: 'Amount' })).toHaveValue('2');
      expect(soyCard.getByTestId('review-grams')).toHaveTextContent('= 36.5 g');
      expect(
        within(card(dialog, LINES[1])).getByRole('checkbox', {
          name: 'Don’t count',
        }),
      ).toBeChecked();

      fireEvent.click(
        soyCard.getByRole('button', { name: `Change food for ${LINES[0]}` }),
      );
      searchFor(dialog, LINES[0], 'tamari');
      expect(
        await soyCard.findByText(
          'No foods match “tamari”. Try fewer or different words.',
        ),
      ).toBeInTheDocument();
      fireEvent.click(
        soyCard.getByRole('button', { name: 'Keep the current food' }),
      );
      expect(soyCard.getByText(SOY.name)).toBeInTheDocument();
    });

    it('says when search is not available', async () => {
      mockFetch(
        () => detail(NOT_WORKED_OUT),
        () => jsonResponse({ error: { code: 'x', message: 'x' } }, 503),
      );
      renderRecipes([detailPath]);
      const dialog = await openReview('Work out nutrition');
      searchFor(dialog, LINES[0], 'soy');
      expect(
        await within(card(dialog, LINES[0])).findByText(
          'Search isn’t available right now. Try again.',
        ),
      ).toBeInTheDocument();
    });

    it('refreshes the lines when the recipe changed meanwhile', async () => {
      const current = recipe({ ingredients: ['3 tbsp soy sauce'], version: 2 });
      const fresh: RecipeNutrition = {
        ...NOT_WORKED_OUT,
        recipeVersion: 2,
        lines: unchecked(['3 tbsp soy sauce']),
      };
      const fetchMock = mockFetch(
        () => detail(WORKED_OUT),
        () => staleVersion(current),
        () => jsonResponse({ nutrition: fresh }),
      );
      renderRecipes([detailPath]);
      const dialog = await openReview('Edit matches');
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Save matches' }),
      );
      expect(
        await within(dialog).findByText(
          'Someone changed this recipe while you were checking it. The list now shows its current ingredients.',
        ),
      ).toBeInTheDocument();
      expect(card(dialog, '3 tbsp soy sauce')).toBeInTheDocument();
      expect(within(dialog).getAllByTestId('review-line')).toHaveLength(1);
      expect(sent(fetchMock, 2)).toMatchObject({
        url: nutritionUrl,
        method: 'GET',
      });
    });

    it('keeps the review open when a save fails', async () => {
      mockFetch(
        () => detail(WORKED_OUT),
        () => Promise.reject(new TypeError('offline')),
      );
      renderRecipes([detailPath]);
      const dialog = await openReview('Edit matches');
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Save matches' }),
      );
      expect(
        await within(dialog).findByText(
          'The matches could not be saved. Check your connection and try again.',
        ),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', { name: 'Save matches' }),
      ).toBeEnabled();
    });

    it('cancels without saving and returns focus to the button', async () => {
      const fetchMock = mockFetch(() => detail(WORKED_OUT));
      renderRecipes([detailPath]);
      const trigger = await screen.findByRole('button', {
        name: 'Edit matches',
      });
      trigger.focus();
      const dialog = await openReview('Edit matches');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(trigger).toHaveFocus();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
