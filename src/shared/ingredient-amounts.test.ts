import { describe, expect, it } from 'vitest';
import {
  isUnitSystem,
  presentIngredientLine,
  presentStepText,
  readIngredientLine,
  readStepText,
  type UnitSystem,
} from './ingredient-amounts';

const show = (line: string, factor: number, system: UnitSystem) =>
  presentIngredientLine(line, { factor, system }).text;

/**
 * Real ingredient lines, copied from each supported site's recipe JSON-LD
 * on 2026-10-01 (RecipeTin Eats lasagna, roast chicken, banana bread, and
 * carbonara; Sally's chocolate chip cookies; Just One Cookbook chicken katsu;
 * Minimalist Baker chana masala). Budget Bytes and The Woks of Life refuse
 * plain fetches, so their rows follow each site's published line format
 * rather than a copied page. Kikkoman rows are the import fixture's.
 *
 * Each row gives the text at factor 1 in Metric and in Imperial, and once
 * scaled. `null` means "exactly as written".
 */
const LINES: readonly {
  site: string;
  line: string;
  metric: string | null;
  imperial: string | null;
  scaled: readonly [number, UnitSystem, string];
}[] = [
  // RecipeTin Eats writes metric and imperial pairs.
  {
    site: 'RecipeTin Eats',
    line: '1 kg / 2 lb  beef mince ((ground beef) (Note 1))',
    metric: '1 kg  beef mince ((ground beef) (Note 1))',
    imperial: '2 lb  beef mince ((ground beef) (Note 1))',
    scaled: [1.5, 'metric', '1.5 kg  beef mince ((ground beef) (Note 1))'],
  },
  {
    site: 'RecipeTin Eats',
    line: '800g / 28 oz  canned crushed tomato',
    metric: '800g  canned crushed tomato',
    imperial: '28 oz  canned crushed tomato',
    scaled: [1.5, 'metric', '1.2 kg  canned crushed tomato'],
  },
  {
    site: 'RecipeTin Eats',
    line: '1 - 2 tsp sugar ((if needed - Note 3))',
    metric: null,
    imperial: null,
    scaled: [1.5, 'metric', '1 ½–3 tsp sugar ((if needed - Note 3))'],
  },
  {
    site: 'RecipeTin Eats',
    line: '60g / 4 tbsp  butter',
    metric: null,
    imperial: '2 oz / 4 tbsp  butter',
    scaled: [1.5, 'metric', '90 g / 6 tbsp  butter'],
  },
  {
    site: 'RecipeTin Eats',
    line: '350g/ 12 oz  fresh lasagna sheets ((or 250g/8oz dried) (Note 5))',
    metric: '350g  fresh lasagna sheets ((or 250g dried) (Note 5))',
    imperial: '12 oz  fresh lasagna sheets ((or 8oz dried) (Note 5))',
    scaled: [
      2,
      'imperial',
      '24 oz  fresh lasagna sheets ((or 8oz dried) (Note 5))',
    ],
  },
  {
    site: 'RecipeTin Eats',
    line: '1 1/2 cups (tightly packed) mozzarella cheese',
    metric: null,
    imperial: null,
    scaled: [1.5, 'metric', '2 ¼ cups (tightly packed) mozzarella cheese'],
  },
  {
    site: 'RecipeTin Eats',
    line: '2 cups gruyere or Colby cheese (, shred yourself (or cheddar, Monterey Jack, OR 1 cup / 100g shredded parmesan) (Note 4))',
    metric: null,
    imperial:
      '2 cups gruyere or Colby cheese (, shred yourself (or cheddar, Monterey Jack, OR 1 cup / 3 ½ oz shredded parmesan) (Note 4))',
    scaled: [
      0.5,
      'metric',
      '1 cup gruyere or Colby cheese (, shred yourself (or cheddar, Monterey Jack, OR 1 cup / 100g shredded parmesan) (Note 4))',
    ],
  },
  {
    site: 'RecipeTin Eats',
    line: '1.75 - 2 kg / 3.5 - 4lb   whole chicken (, patted dry)',
    metric: '1.75 - 2 kg   whole chicken (, patted dry)',
    imperial: '3.5 - 4lb   whole chicken (, patted dry)',
    scaled: [1.5, 'metric', '2.6–3 kg   whole chicken (, patted dry)'],
  },
  {
    site: 'RecipeTin Eats',
    line: '100 g / 1 stick   unsalted butter (, melted)',
    metric: null,
    imperial: '3 ½ oz / 1 stick   unsalted butter (, melted)',
    scaled: [1.5, 'metric', '150 g / 1 ½ stick   unsalted butter (, melted)'],
  },
  {
    site: 'RecipeTin Eats',
    line: '1 cup / 250 ml  dry white wine (, or low sodium chicken broth)',
    metric: null,
    imperial:
      '1 cup / 8 ½ fl oz  dry white wine (, or low sodium chicken broth)',
    scaled: [
      1.5,
      'metric',
      '1 ½ cups / 375 ml  dry white wine (, or low sodium chicken broth)',
    ],
  },
  {
    site: 'RecipeTin Eats',
    line: '4  medium ripe banana  ((400g / 14oz peeled, makes 1 3/4 cup once puréed) (Note 2))',
    metric:
      '4  medium ripe banana  ((400g peeled, makes 1 3/4 cup once puréed) (Note 2))',
    imperial:
      '4  medium ripe banana  ((14oz peeled, makes 1 3/4 cup once puréed) (Note 2))',
    scaled: [
      1.5,
      'metric',
      '6  medium ripe banana  ((400g peeled, makes 1 3/4 cup once puréed) (Note 2))',
    ],
  },
  {
    site: 'RecipeTin Eats',
    line: '80g (5 tbsp)  unsalted butter (, melted)',
    metric: null,
    imperial: '3 oz (5 tbsp)  unsalted butter (, melted)',
    scaled: [1.5, 'metric', '120 g (7 ½ tbsp)  unsalted butter (, melted)'],
  },
  {
    site: 'RecipeTin Eats',
    line: '2 1/4 cup plain flour / all-purpose flour',
    metric: null,
    imperial: null,
    scaled: [2, 'metric', '4 ½ cups plain flour / all-purpose flour'],
  },
  {
    site: 'RecipeTin Eats',
    line: '2 large egg + 1  egg yolk (, at room temperature (~55g/2oz shell-on weight))',
    metric:
      '2 large egg + 1  egg yolk (, at room temperature (~55g shell-on weight))',
    imperial:
      '2 large egg + 1  egg yolk (, at room temperature (~2oz shell-on weight))',
    scaled: [
      2,
      'metric',
      '4 large egg + 1  egg yolk (, at room temperature (~55g shell-on weight))',
    ],
  },
  {
    site: 'RecipeTin Eats',
    line: '175g/6 oz  guanciale (pancetta or block bacon), ( weight after skin removed (Note 1))',
    metric:
      '175g  guanciale (pancetta or block bacon), ( weight after skin removed (Note 1))',
    imperial:
      '6 oz  guanciale (pancetta or block bacon), ( weight after skin removed (Note 1))',
    scaled: [
      2,
      'metric',
      '350 g  guanciale (pancetta or block bacon), ( weight after skin removed (Note 1))',
    ],
  },
  {
    site: 'RecipeTin Eats',
    line: '1 tightly packed cup brown sugar',
    metric: null,
    imperial: null,
    scaled: [2, 'metric', '2 tightly packed cup brown sugar'],
  },
  // Sally's Baking Addiction restates cups as spoons and grams.
  {
    site: "Sally's Baking Addiction",
    line: '3/4 cup (12 Tbsp; 170g) unsalted butter, softened to room temperature',
    metric: null,
    imperial:
      '3/4 cup (12 Tbsp; 6 oz) unsalted butter, softened to room temperature',
    scaled: [
      2,
      'metric',
      '1 ½ cups (24 Tbsp; 340 g) unsalted butter, softened to room temperature',
    ],
  },
  {
    site: "Sally's Baking Addiction",
    line: '3/4 cup (150g) packed light or dark brown sugar',
    metric: null,
    imperial: '3/4 cup (5 ½ oz) packed light or dark brown sugar',
    scaled: [
      0.5,
      'imperial',
      '⅜ cup (2 ½ oz) packed light or dark brown sugar',
    ],
  },
  {
    site: "Sally's Baking Addiction",
    line: '1 large egg, at room temperature',
    metric: null,
    imperial: null,
    scaled: [2, 'metric', '2 large egg, at room temperature'],
  },
  {
    site: "Sally's Baking Addiction",
    line: '2 teaspoons pure vanilla extract',
    metric: null,
    imperial: null,
    scaled: [0.5, 'metric', '1 teaspoon pure vanilla extract'],
  },
  {
    site: "Sally's Baking Addiction",
    line: '2 cups (250g) all-purpose flour (spooned & leveled)',
    metric: null,
    imperial: '2 cups (9 oz) all-purpose flour (spooned & leveled)',
    scaled: [
      1.5,
      'metric',
      '3 cups (375 g) all-purpose flour (spooned & leveled)',
    ],
  },
  {
    site: "Sally's Baking Addiction",
    line: '1 and 1/4 cup (225g) semi-sweet chocolate chips',
    metric: null,
    imperial: '1 and 1/4 cup (8 oz) semi-sweet chocolate chips',
    scaled: [2, 'imperial', '2 ½ cups (1 lb) semi-sweet chocolate chips'],
  },
  // Just One Cookbook uses Unicode fractions and metric in parentheses.
  {
    site: 'Just One Cookbook',
    line: '½ tsp Diamond Crystal kosher salt',
    metric: null,
    imperial: null,
    scaled: [1.5, 'metric', '¾ tsp Diamond Crystal kosher salt'],
  },
  {
    site: 'Just One Cookbook',
    line: '⅛ tsp freshly ground black pepper',
    metric: null,
    imperial: null,
    scaled: [3, 'metric', '⅜ tsp freshly ground black pepper'],
  },
  {
    site: 'Just One Cookbook',
    line: '3 cups neutral oil ((for deep-frying; enough for 1½ inches (3.8 cm) of oil in the pot))',
    metric:
      '3 cups neutral oil ((for deep-frying; enough for 3.8 cm of oil in the pot))',
    imperial:
      '3 cups neutral oil ((for deep-frying; enough for 1½ inches of oil in the pot))',
    scaled: [
      1.5,
      'metric',
      '4 ½ cups neutral oil ((for deep-frying; enough for 3.8 cm of oil in the pot))',
    ],
  },
  {
    site: 'Just One Cookbook',
    line: '1  large egg (50 g each w/o shell)',
    metric: null,
    imperial: '1  large egg (2 oz each w/o shell)',
    scaled: [2, 'metric', '2  large egg (50 g each w/o shell)'],
  },
  {
    site: 'Just One Cookbook',
    line: '1 piece boneless, skinless chicken breast',
    metric: null,
    imperial: null,
    scaled: [2, 'metric', '2 piece boneless, skinless chicken breast'],
  },
  {
    site: 'Just One Cookbook',
    line: '½ Tbsp neutral oil ((for the egg))',
    metric: null,
    imperial: null,
    scaled: [2, 'metric', '1 Tbsp neutral oil ((for the egg))'],
  },
  // Minimalist Baker writes pack sizes and ranges.
  {
    site: 'Minimalist Baker',
    line: '1 (28-ounce) can puréed*, crushed, or finely diced tomatoes  ((if unsalted, you’ll add more salt to the dish))',
    metric:
      '1 (795 g) can puréed*, crushed, or finely diced tomatoes  ((if unsalted, you’ll add more salt to the dish))',
    imperial: null,
    scaled: [
      2,
      'imperial',
      '2 (28-ounce) can puréed*, crushed, or finely diced tomatoes  ((if unsalted, you’ll add more salt to the dish))',
    ],
  },
  {
    site: 'Minimalist Baker',
    line: '2 (15-ounce) cans chickpeas, slightly drained',
    metric: '2 (425 g) cans chickpeas, slightly drained',
    imperial: null,
    scaled: [1.5, 'metric', '3 (425 g) cans chickpeas, slightly drained'],
  },
  {
    site: 'Minimalist Baker',
    line: '2-3 fresh green chilies*, sliced with seeds ((I used serrano peppers // reduce amount if you prefer less heat))',
    metric: null,
    imperial: null,
    scaled: [
      2,
      'metric',
      '4–6 fresh green chilies*, sliced with seeds ((I used serrano peppers // reduce amount if you prefer less heat))',
    ],
  },
  {
    site: 'Minimalist Baker',
    line: '3/4 tsp sea salt ((divided // plus more to taste))',
    metric: null,
    imperial: null,
    scaled: [2, 'metric', '1 ½ tsp sea salt ((divided // plus more to taste))'],
  },
  {
    site: 'Minimalist Baker',
    line: '6 cloves garlic, minced ((6 cloves yield ~3 Tbsp))',
    metric: null,
    imperial: null,
    scaled: [
      0.5,
      'metric',
      '3 cloves garlic, minced ((6 cloves yield ~3 Tbsp))',
    ],
  },
  // Budget Bytes format: US units, abbreviation periods, and prices.
  {
    site: 'Budget Bytes (format)',
    line: '1/2 lb. ground beef ($2.50)',
    metric: '225 g ground beef ($2.50)',
    imperial: null,
    scaled: [0.5, 'imperial', '¼ lb ground beef ($2.50)'],
  },
  {
    site: 'Budget Bytes (format)',
    line: '1 15oz. can tomato sauce ($0.50)',
    metric: '1 (425 g) can tomato sauce ($0.50)',
    imperial: null,
    scaled: [2, 'metric', '2 (425 g) can tomato sauce ($0.50)'],
  },
  {
    site: 'Budget Bytes (format)',
    line: '8 oz. pasta ($0.50)',
    metric: '225 g pasta ($0.50)',
    imperial: null,
    scaled: [0.5, 'imperial', '4 oz pasta ($0.50)'],
  },
  {
    site: 'Budget Bytes (format)',
    line: '2 8-ounce packages cream cheese',
    metric: '2 (225 g) packages cream cheese',
    imperial: null,
    scaled: [2, 'metric', '4 (225 g) packages cream cheese'],
  },
  {
    site: 'Budget Bytes (format)',
    line: '1 lb shelf-stable gnocchi',
    metric: '455 g shelf-stable gnocchi',
    imperial: null,
    scaled: [1.5, 'metric', '680 g shelf-stable gnocchi'],
  },
  {
    site: 'Budget Bytes (format)',
    line: '1 pint cherry tomatoes',
    metric: '475 ml cherry tomatoes',
    imperial: null,
    scaled: [2, 'imperial', '2 pints cherry tomatoes'],
  },
  // The Woks of Life format: spelled-out US units and gram pairs.
  {
    site: 'The Woks of Life (format)',
    line: '1 1/2 pounds (680g) pork shoulder',
    metric: '680g pork shoulder',
    imperial: '1 1/2 pounds pork shoulder',
    scaled: [2, 'metric', '1.4 kg pork shoulder'],
  },
  {
    site: 'The Woks of Life (format)',
    line: '2 scallions (cut into 2-inch pieces)',
    metric: '2 scallions (cut into 5 cm pieces)',
    imperial: null,
    scaled: [2, 'imperial', '4 scallions (cut into 2-inch pieces)'],
  },
  {
    site: 'The Woks of Life (format)',
    line: '8 ounces dried rice noodles',
    metric: '225 g dried rice noodles',
    imperial: null,
    scaled: [3, 'imperial', '24 oz dried rice noodles'],
  },
  {
    site: 'The Woks of Life (format)',
    line: '2 tablespoons Shaoxing wine',
    metric: null,
    imperial: null,
    scaled: [0.5, 'metric', '1 tablespoon Shaoxing wine'],
  },
  // Kikkoman writes Japanese with full-width digits, which are not read.
  {
    site: 'Kikkoman',
    line: 'ぶり　４切れ',
    metric: null,
    imperial: null,
    scaled: [2, 'metric', 'ぶり　４切れ'],
  },
  {
    site: 'Kikkoman',
    line: 'みりん　大さじ１と½',
    metric: null,
    imperial: null,
    scaled: [2, 'metric', 'みりん　大さじ１と½'],
  },
];

/** Real step sentences from the same pages, read for temperatures and lengths. */
const STEPS: readonly {
  site: string;
  text: string;
  metric: string | null;
  imperial: string | null;
}[] = [
  {
    site: 'RecipeTin Eats',
    text: 'Preheat oven to 220C/450F (standard) or 200C/430F (fan/convection). Put shelf in the middle.',
    metric:
      'Preheat oven to 220C (standard) or 200C (fan/convection). Put shelf in the middle.',
    imperial:
      'Preheat oven to 450F (standard) or 430F (fan/convection). Put shelf in the middle.',
  },
  {
    site: 'RecipeTin Eats',
    text: 'Roast for a further 1 hr 15 minutes, or until the internal temperature is 75C/165F',
    metric:
      'Roast for a further 1 hr 15 minutes, or until the internal temperature is 75C',
    imperial:
      'Roast for a further 1 hr 15 minutes, or until the internal temperature is 165F',
  },
  {
    site: 'RecipeTin Eats',
    text: 'Preheat oven to 180°C/350°F (160°C fan-forced).',
    metric: 'Preheat oven to 180°C (160°C fan-forced).',
    imperial: 'Preheat oven to 350°F (325°F fan-forced).',
  },
  {
    site: 'RecipeTin Eats',
    text: 'Scrunch a 40 cm / 16" sheet of baking / parchment paper and press it into a loaf pan (21.5 x 11.5 x 7 cm / 4.5 x 8.5 x 2.75"), leaving overhang',
    metric:
      'Scrunch a 40 cm sheet of baking / parchment paper and press it into a loaf pan (21.5 x 11.5 x 7 cm), leaving overhang',
    imperial:
      'Scrunch a 16" sheet of baking / parchment paper and press it into a loaf pan (4.5 x 8.5 x 2.75"), leaving overhang',
  },
  {
    site: 'RecipeTin Eats',
    text: 'Use a 33 x 22 x 7 cm / 13 x 9 x 2.5" baking dish.',
    metric: 'Use a 33 x 22 x 7 cm baking dish.',
    imperial: 'Use a 13 x 9 x 2.5" baking dish.',
  },
  {
    site: 'RecipeTin Eats',
    text: 'Guanciale - Cut into 0.5cm / 1/5" thick slices then into batons.',
    metric: 'Guanciale - Cut into 0.5cm thick slices then into batons.',
    imperial: 'Guanciale - Cut into 1/5" thick slices then into batons.',
  },
  {
    site: 'RecipeTin Eats',
    text: 'Cook pasta - Bring 4 litres (4 quarts) of water to the boil with the salt.',
    metric: null,
    imperial: null,
  },
  {
    site: "Sally's Baking Addiction",
    text: 'Preheat oven to 350°F (177°C). Line 2 large baking sheets with parchment paper.',
    metric:
      'Preheat oven to 177°C. Line 2 large baking sheets with parchment paper.',
    imperial:
      'Preheat oven to 350°F. Line 2 large baking sheets with parchment paper.',
  },
  {
    site: 'Just One Cookbook',
    text: 'pound the chicken pieces to an even thickness of about ¼–½ inch (6 mm–1.3 cm).',
    metric:
      'pound the chicken pieces to an even thickness of about 6 mm–1.3 cm.',
    imperial:
      'pound the chicken pieces to an even thickness of about ¼–½ inch.',
  },
  {
    site: 'Just One Cookbook',
    text: 'I use a Staub 2.75 QT Dutch oven, 11 inches in diameter',
    metric: 'I use a Staub 2.75 QT Dutch oven, 28 cm in diameter',
    imperial: null,
  },
  {
    site: 'Just One Cookbook',
    text: "If the oil isn't hot enough (340ºF or 170ºC), increase the heat to medium.",
    metric: "If the oil isn't hot enough (170ºC), increase the heat to medium.",
    imperial:
      "If the oil isn't hot enough (340ºF), increase the heat to medium.",
  },
  {
    site: 'Just One Cookbook',
    text: 'Turn the chicken 180 degrees and butterfly the second side.',
    metric: null,
    imperial: null,
  },
  {
    site: 'Just One Cookbook',
    text: 'Cut the chicken katsu into 1-inch (2.5 cm) pieces and serve it',
    metric: 'Cut the chicken katsu into 2.5 cm pieces and serve it',
    imperial: 'Cut the chicken katsu into 1-inch pieces and serve it',
  },
  {
    site: 'Minimalist Baker',
    text: 'add up to 1 cup (240 ml) water and simmer for 15-20 minutes',
    metric: null,
    imperial: null,
  },
  {
    site: 'Budget Bytes (format)',
    text: 'Heat the oven to 425°F.',
    metric: 'Heat the oven to 220°C.',
    imperial: null,
  },
  {
    site: 'Budget Bytes (format)',
    text: 'Pour into a 9x13" baking dish and bake at 400ºF.',
    metric: 'Pour into a 23 x 33 cm baking dish and bake at 200°C.',
    imperial: null,
  },
  {
    site: 'The Woks of Life (format)',
    text: 'roast at 400 degrees F (200 degrees C) for 20 minutes',
    metric: 'roast at 200 degrees C for 20 minutes',
    imperial: 'roast at 400 degrees F for 20 minutes',
  },
  {
    site: 'Kikkoman',
    text: '大根は２cm厚さの半月切りにする。',
    metric: null,
    imperial: null,
  },
];

describe('presentIngredientLine on real lines', () => {
  it('has at least 40 lines from every supported site', () => {
    expect(LINES.length).toBeGreaterThanOrEqual(40);
    expect(
      new Set(LINES.map(({ site }) => site.replace(/ \(format\)$/u, ''))),
    ).toEqual(
      new Set([
        'RecipeTin Eats',
        "Sally's Baking Addiction",
        'Just One Cookbook',
        'Minimalist Baker',
        'Budget Bytes',
        'The Woks of Life',
        'Kikkoman',
      ]),
    );
  });

  it.each(LINES)('$site: $line', ({ line, metric, imperial, scaled }) => {
    expect(show(line, 1, 'metric')).toBe(metric ?? line);
    expect(show(line, 1, 'imperial')).toBe(imperial ?? line);
    const [factor, system, text] = scaled;
    expect(show(line, factor, system)).toBe(text);
  });
});

describe('presentStepText on real steps', () => {
  it('has at least 10 steps', () => {
    expect(STEPS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(STEPS)('$site: $text', ({ text, metric, imperial }) => {
    expect(presentStepText(text, { system: 'metric' }).text).toBe(
      metric ?? text,
    );
    expect(presentStepText(text, { system: 'imperial' }).text).toBe(
      imperial ?? text,
    );
  });

  it('converts the scenario step to metric', () => {
    expect(
      presentStepText('Bake at 375°F in a 9x13-inch pan', { system: 'metric' })
        .text,
    ).toBe('Bake at 190°C in a 23 x 33 cm pan');
  });

  it('reads each temperature spelling', () => {
    for (const text of [
      'Bake at 375°F.',
      'Bake at 375 °F.',
      'Bake at 375 degrees F.',
      'Bake at 375 degrees Fahrenheit.',
      'Bake at 375ºF.',
    ]) {
      expect(presentStepText(text, { system: 'metric' }).text).toBe(
        'Bake at 190°C.',
      );
    }
  });

  it('never reads a bare C or F in an ingredient line', () => {
    expect(show('2 C flour', 1, 'imperial')).toBe('2 C flour');
    expect(show('350F oven-ready noodles', 1, 'metric')).toBe(
      '350F oven-ready noodles',
    );
  });

  it('leaves amounts other than temperatures and lengths in steps', () => {
    expect(readStepText('Add 1 lb beef and 2 cups water.')).toEqual([]);
  });
});

describe('the scenarios', () => {
  it('reads 1 lb as 455 g, and 680 g for 6 of 4 servings', () => {
    expect(show('1 lb chicken thighs', 1, 'metric')).toBe(
      '455 g chicken thighs',
    );
    expect(show('1 lb chicken thighs', 6 / 4, 'metric')).toBe(
      '680 g chicken thighs',
    );
    expect(show('2 eggs', 6 / 4, 'metric')).toBe('3 eggs');
  });

  it('reads 500 g as 1 lb in Imperial', () => {
    expect(show('500 g beef mince', 1, 'imperial')).toBe('1 lb beef mince');
  });

  it('passes lines it cannot read through at any factor and system', () => {
    for (const line of ['salt and pepper to taste', 'a handful of basil']) {
      for (const system of ['metric', 'imperial'] as const) {
        for (const factor of [0.5, 1, 3]) {
          const result = presentIngredientLine(line, { factor, system });
          expect(result).toEqual({
            text: line,
            changed: false,
            converted: false,
            scaled: false,
          });
        }
      }
    }
  });
});

describe('rounding', () => {
  // Metric amounts are scaled from 1 g or 1 ml so the exact value is known.
  it.each([
    [4.74, '4.5 g'],
    [4.76, '5 g'],
    [0.1, '0.5 g'],
    [9.4, '9.5 g'],
    [10.4, '10 g'],
    [99.4, '99 g'],
    [102, '100 g'],
    [453, '455 g'],
    [997, '995 g'],
    [998, '1 kg'],
    [1440, '1.4 kg'],
    [2260, '2.3 kg'],
  ])('metric mass %s g reads %s', (grams, text) => {
    expect(show('1 g salt', grams, 'metric')).toBe(`${text} salt`);
  });

  it('turns millilitres into litres from 1,000', () => {
    expect(show('500 ml stock', 3, 'metric')).toBe('1.5 l stock');
    expect(show('1 L stock', 0.5, 'metric')).toBe('500 ml stock');
  });

  it.each([
    ['¼ inch', '6 mm'],
    ['1 inch', '2.5 cm'],
    ['1½ inches', '4 cm'],
    ['9 inch', '23 cm'],
    ['13-inch', '33 cm'],
  ])('metric length %s reads %s', (amount, text) => {
    expect(
      presentStepText(`a ${amount} round`, { system: 'metric' }).text,
    ).toBe(`a ${text} round`);
  });

  it.each([
    ['210°F', '99°C'],
    ['212°F', '100°C'],
    ['350°F', '180°C'],
    ['375°F', '190°C'],
    ['425°F', '220°C'],
  ])('°C: %s reads %s', (from, to) => {
    expect(presentStepText(`at ${from}`, { system: 'metric' }).text).toBe(
      `at ${to}`,
    );
  });

  it.each([
    ['90°C', '195°F'],
    ['160°C', '325°F'],
    ['180°C', '350°F'],
    ['200°C', '400°F'],
    ['220°C', '425°F'],
  ])('°F: %s reads %s', (from, to) => {
    expect(presentStepText(`at ${from}`, { system: 'imperial' }).text).toBe(
      `at ${to}`,
    );
  });

  it.each([
    ['5 g', '⅛ oz'],
    ['14 g', '½ oz'],
    ['440 g', '15 ½ oz'],
    ['450 g', '1 lb'],
    ['1 kg', '2 ¼ lb'],
    ['250 ml', '8 ½ fl oz'],
    ['23 cm', '9 in'],
    ['2.5 cm', '1 in'],
    ['6 mm', '¼ in'],
  ])('imperial: %s reads %s', (from, to) => {
    expect(show(`${from} thing`, 1, 'imperial')).toBe(`${to} thing`);
  });

  it('keeps ounces when scaling ounces in Imperial', () => {
    expect(show('12 oz pasta', 2, 'imperial')).toBe('24 oz pasta');
  });

  it('uses the nearest fraction for counts, cups, and spoons', () => {
    expect(show('1 cup rice', 2 / 3, 'metric')).toBe('⅔ cup rice');
    expect(show('3 eggs', 1 / 3, 'metric')).toBe('1 eggs');
    expect(show('1 egg', 0.05, 'metric')).toBe('⅛ egg');
    expect(show('1 tsp salt', 2.9, 'metric')).toBe('2 ⅞ tsp salt');
    expect(show('2 Cups milk', 0.5, 'metric')).toBe('1 Cup milk');
  });

  it('gives the same text for the same line, factor, and system', () => {
    const line = '1.75 - 2 kg / 3.5 - 4lb whole chicken';
    const first = show(line, 1.25, 'imperial');
    expect(show(line, 1.25, 'imperial')).toBe(first);
  });
});

describe('numbers and ranges', () => {
  it.each([
    ['1 1/2 cups flour'],
    ['1½ cups flour'],
    ['1 ½ cups flour'],
    ['1 and 1/2 cups flour'],
    ['1.5 cups flour'],
    ['3/2 cups flour'],
  ])('reads %s as one and a half', (line) => {
    expect(show(line, 2, 'metric')).toBe('3 cups flour');
  });

  it.each([
    ['2-3 eggs', '4–6 eggs'],
    ['2 - 3 eggs', '4–6 eggs'],
    ['2–3 eggs', '4–6 eggs'],
    ['2 to 3 eggs', '4–6 eggs'],
    ['⅓–½ cup stock', '⅔–1 cup stock'],
  ])('scales the range %s end by end', (line, text) => {
    expect(show(line, 2, 'metric')).toBe(text);
  });

  it('shows one value when both ends of a range round alike', () => {
    expect(show('450-454 g mince', 1, 'imperial')).toBe('1 lb mince');
  });

  it('converts a range by its larger end', () => {
    expect(show('800-1200 g potatoes', 1, 'imperial')).toBe(
      '1 ¾–2 ¾ lb potatoes',
    );
    expect(show('1/2 - 3 lb potatoes', 1, 'metric')).toBe(
      '0.2–1.4 kg potatoes',
    );
  });

  it.each([
    ['1,5 kg flour'],
    ['1,000 g flour'],
    ['7up, 1 can'],
    ['Vitamin B12 drops'],
    ['$3.99 bag of rice'],
    ['bought 10/02/2026'],
    ['3rd jar of jam'],
    ['<img src=x onerror="window.pwned=1">'],
  ])('does not read %s', (line) => {
    expect(readIngredientLine(line).leading).toBeNull();
    expect(show(line, 2, 'imperial')).toBe(line);
  });
});

describe('reading', () => {
  it('finds the leading amount after an optional bullet', () => {
    expect(readIngredientLine('- 2 eggs').leading?.values).toEqual([2]);
    expect(readIngredientLine('• 2 eggs').leading?.values).toEqual([2]);
    expect(readIngredientLine('Eggs, 2').leading).toBeNull();
  });

  it('reads units in any case, with or without a space or period', () => {
    for (const line of ['1 lb beef', '1lb beef', '1 LB beef', '1 lb. beef']) {
      expect(show(line, 1, 'metric')).toBe('455 g beef');
    }
    expect(show('1 lb.', 1, 'metric')).toBe('455 g.');
  });

  it('reads T as a tablespoon and t as a teaspoon without converting', () => {
    const [tablespoon] = readIngredientLine('1 T oil').amounts;
    const [teaspoon] = readIngredientLine('1 t salt').amounts;
    expect(tablespoon?.unit?.base).toBe(15);
    expect(teaspoon?.unit?.base).toBe(5);
    expect(show('1 T oil', 1, 'imperial')).toBe('1 T oil');
  });

  it('treats oz as mass and only fl oz as volume', () => {
    expect(show('8 oz milk', 1, 'metric')).toBe('225 g milk');
    expect(show('8 fl oz milk', 1, 'metric')).toBe('235 ml milk');
    expect(show('8 fl. oz milk', 1, 'metric')).toBe('235 ml milk');
  });

  it('reads "in" as inches only against its number', () => {
    expect(presentStepText('a 9in pan', { system: 'metric' }).text).toBe(
      'a 23 cm pan',
    );
    expect(
      presentStepText('leave 2 in the pan', { system: 'metric' }).text,
    ).toBe('leave 2 in the pan');
  });

  it('scales the pack count but only converts the pack size', () => {
    expect(show('1 x 400 g can diced tomatoes', 2, 'metric')).toBe(
      '2 x 400 g can diced tomatoes',
    );
    expect(show('1 x 400 g can diced tomatoes', 2, 'imperial')).toBe(
      '2 x 14 oz can diced tomatoes',
    );
    expect(show('2 (14 oz) cans coconut milk', 1.5, 'metric')).toBe(
      '3 (395 g) cans coconut milk',
    );
  });

  it('converts but never scales other amounts', () => {
    expect(show('1 bag (about 8 oz) spinach', 2, 'metric')).toBe(
      '2 bag (about 225 g) spinach',
    );
  });

  it('reports whether a line was converted, scaled, or both', () => {
    expect(
      presentIngredientLine('1 lb beef', { factor: 2, system: 'metric' }),
    ).toEqual({
      text: '905 g beef',
      changed: true,
      converted: true,
      scaled: true,
    });
    expect(
      presentIngredientLine('2 eggs', { factor: 2, system: 'imperial' }),
    ).toEqual({
      text: '4 eggs',
      changed: true,
      converted: false,
      scaled: true,
    });
    expect(
      presentIngredientLine('1 kg / 2 lb beef', {
        factor: 1,
        system: 'metric',
      }),
    ).toEqual({
      text: '1 kg beef',
      changed: true,
      converted: true,
      scaled: false,
    });
  });
});

describe('factor 1 in the line’s own system', () => {
  it('leaves every metric and neutral line byte for byte as written', () => {
    for (const line of [
      '1.75 - 2 kg   whole chicken',
      '1  large egg (50 g each w/o shell)',
      '1 and 1/4 cup (225g) chips',
      '  2   tbsp  oil  ',
      '60g / 4 tbsp  butter',
    ]) {
      const result = presentIngredientLine(line, {
        factor: 1,
        system: 'metric',
      });
      expect(result.text).toBe(line);
      expect(result.changed).toBe(false);
    }
  });

  it('leaves every imperial line byte for byte as written', () => {
    for (const line of [
      '1 (28-ounce) can tomatoes',
      '1/2 lb. ground beef ($2.50)',
      '3 1/2 - 4 LBS chicken',
    ]) {
      expect(show(line, 1, 'imperial')).toBe(line);
    }
  });
});

describe('performance', () => {
  it('reads 100 hostile 300-character lines quickly', () => {
    const lines = [
      '1 '.repeat(150),
      '1/'.repeat(150),
      '1 - '.repeat(75),
      '1x'.repeat(150),
      '1 and '.repeat(50),
      '1 g / '.repeat(50),
      '1 g ('.repeat(60),
      `${'9'.repeat(299)}g`,
    ];
    const started = performance.now();
    for (let index = 0; index < 100; index += 1) {
      const line = lines[index % lines.length];
      presentIngredientLine(line, { factor: 1.5, system: 'imperial' });
      presentStepText(line, { system: 'metric' });
    }
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('isUnitSystem', () => {
  it('accepts only the two systems', () => {
    expect(isUnitSystem('metric')).toBe(true);
    expect(isUnitSystem('imperial')).toBe(true);
    expect(isUnitSystem('Metric')).toBe(false);
    expect(isUnitSystem(null)).toBe(false);
  });
});
