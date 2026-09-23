/**
 * Recipe pages for the import tests. Every one is a local string: no test in
 * this repository may contact a real website.
 *
 * The markup mirrors what the allowlisted sites actually publish — a JSON-LD
 * block in the head, other scripts around it, and recipe text that carries
 * entities and inline tags.
 */

export const htmlPage = (
  title: string,
  jsonLd: string,
  extra = '',
): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <script>window.analytics = { track: function () {} };</script>
    <script type="application/ld+json">
${jsonLd}
    </script>
    ${extra}
  </head>
  <body>
    <h1>${title}</h1>
    <p>Rendered markup is never read; only the JSON-LD above is.</p>
  </body>
</html>`;

/** A single `Recipe` object, the commonest shape. */
export const SIMPLE_RECIPE_PAGE = htmlPage(
  'Oyakodon (Chicken and Egg Rice Bowl) - Just One Cookbook',
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'Oyakodon &#8211; Chicken &amp; Egg Rice Bowl',
    author: { '@type': 'Person', name: 'Namiko Chen' },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8' },
    recipeYield: '2 donburi bowls',
    cookTime: 'PT15M',
    image: ['https://www.justonecookbook.com/oyakodon.jpg'],
    nutrition: { '@type': 'NutritionInformation', calories: '600 kcal' },
    recipeIngredient: [
      '2 servings <b>cooked Japanese short-grain rice</b>',
      '&frac12; onion',
      '2 Tbsp soy sauce',
      '4 large eggs',
    ],
    recipeInstructions: [
      'Slice the onion thinly.',
      'Simmer the onion in the sauce until translucent.',
      'Pour the beaten eggs over the chicken and cover.',
      'Serve over rice.',
    ],
  }),
);

/** A `@graph` container with the recipe beside unrelated page objects. */
export const GRAPH_RECIPE_PAGE = htmlPage(
  'Sheet Pan Gnocchi - Budget Bytes',
  JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Budget Bytes' },
      { '@type': 'WebSite', name: 'Budget Bytes' },
      {
        '@type': ['Recipe', 'NewsArticle'],
        name: 'Sheet Pan Gnocchi',
        recipeIngredient: [
          '1 lb shelf-stable gnocchi',
          '2 Tbsp olive oil',
          '1 pint cherry tomatoes',
        ],
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Heat the oven to 425°F.' },
          {
            '@type': 'HowToStep',
            name: 'Toss',
            text: 'Toss the gnocchi with the oil and tomatoes.',
          },
          { '@type': 'HowToStep', name: 'Roast for 25 minutes.' },
        ],
      },
    ],
  }),
);

/** Instructions grouped into `HowToSection`s, which must flatten in order. */
export const SECTIONED_RECIPE_PAGE = htmlPage(
  'Chocolate Chip Cookies - Sally’s Baking Addiction',
  JSON.stringify([
    { '@type': 'BreadcrumbList', itemListElement: [] },
    {
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Chocolate Chip Cookies',
      recipeIngredient: ['2 cups flour', '1 cup butter', '1 cup sugar'],
      recipeInstructions: [
        {
          '@type': 'HowToSection',
          name: 'Make the dough',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Cream the butter and sugar.' },
            { '@type': 'HowToStep', text: 'Fold in the flour.' },
          ],
        },
        { '@type': 'HowToStep', text: 'Chill the dough for two hours.' },
        {
          '@type': 'HowToSection',
          name: 'Bake',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Scoop onto a lined sheet.' },
            { '@type': 'HowToStep', text: 'Bake for 12 minutes.' },
          ],
        },
      ],
    },
  ]),
);

/** Non-ASCII text, Japanese units, and full-width characters. */
export const JAPANESE_RECIPE_PAGE = htmlPage(
  'ぶり大根 | キッコーマン',
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: 'ぶり大根',
    recipeIngredient: [
      'ぶり　４切れ',
      '大根　１／２本',
      'しょうゆ　大さじ２',
      'みりん　大さじ１と&frac12;',
    ],
    recipeInstructions: [
      { '@type': 'HowToStep', text: '大根は２cm厚さの半月切りにする。' },
      { '@type': 'HowToStep', text: 'ぶりは熱湯にさっとくぐらせる。' },
      { '@type': 'HowToStep', text: 'しょうゆ・みりんで１５分煮る。' },
    ],
  }),
);

/** JSON-LD that is present but carries no recipe. */
export const NO_RECIPE_PAGE = htmlPage(
  'Budget Bytes',
  JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite' }),
);
