/**
 * Reads a recipe draft out of the JSON-LD found on a page.
 *
 * Only schema.org `Recipe` objects are read, as the accepted #31 design
 * decided: no microdata, no heuristic scraping, no AI. Each script's text is
 * handed to `JSON.parse` and never evaluated, and only three properties are
 * looked at — `name`, `recipeIngredient`, and `recipeInstructions`. Yield,
 * times, images, ratings, nutrition, and author are ignored on purpose, so a
 * page cannot smuggle anything else into the family's library.
 *
 * Everything that comes out is plain text: tags are stripped, entities are
 * decoded once, and `cleanRecipeLine` removes control characters and collapses
 * whitespace. The client renders it as text, never as markup.
 */

import { cleanRecipeLine, type RecipeDraft } from '../../shared/recipes';

/**
 * A page is bounded to 2 MiB, so a hostile document could still hold a great
 * many nodes. The draft is cut to 100 ingredients and 50 steps later anyway,
 * so collecting far past that is only work the family pays for.
 */
const MAX_EXTRACTED_LINES = 400;

/** JSON-LD nests shallowly; a deeper structure is not a recipe page. */
const MAX_DEPTH = 6;

// ---------------------------------------------------------------------------
// Plain text

/**
 * The entities that actually turn up in recipe text. An unknown entity is
 * left as written rather than guessed at, which reads oddly but never invents
 * a character the page did not have.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  bull: '•',
  ccedil: 'ç',
  copy: '©',
  deg: '°',
  divide: '÷',
  eacute: 'é',
  egrave: 'è',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  gt: '>',
  hellip: '…',
  laquo: '«',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  middot: '·',
  nbsp: ' ',
  ndash: '–',
  ntilde: 'ñ',
  quot: '"',
  raquo: '»',
  rdquo: '”',
  reg: '®',
  rsquo: '’',
  sup2: '²',
  sup3: '³',
  times: '×',
  trade: '™',
  uuml: 'ü',
};

const TAG = /<[^>]*>/gu;
const NUMERIC_ENTITY = /&#(x[0-9a-f]+|\d+);/giu;
const NAMED_ENTITY = /&([a-z][a-z0-9]{1,31});/giu;

const fromCodePoint = (raw: string, match: string): string => {
  const point =
    raw[0].toLowerCase() === 'x'
      ? Number.parseInt(raw.slice(1), 16)
      : Number.parseInt(raw, 10);
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) return match;
  // A lone surrogate is a valid code point here but not a character;
  // `cleanRecipeLine` drops it, so producing it is safe.
  return String.fromCodePoint(point);
};

/**
 * Tags are removed **before** entities are decoded, which is the order that
 * keeps a page honest: `&lt;b&gt;` was written to be read as the literal text
 * `<b>`, and decoding first would delete it as if it had been a real tag.
 * Nothing is decoded twice, so `&amp;lt;` stays `&lt;`.
 */
export const htmlToPlainText = (value: string): string =>
  cleanRecipeLine(
    value
      .replace(TAG, ' ')
      .replace(NUMERIC_ENTITY, (match, raw: string) =>
        fromCodePoint(raw, match),
      )
      .replace(
        NAMED_ENTITY,
        (match, name: string) =>
          NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? match,
      ),
  );

// ---------------------------------------------------------------------------
// Reading the graph

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const typeNames = (node: JsonObject): string[] => {
  const type = node['@type'];
  const raw = Array.isArray(type) ? type : [type];
  return raw
    .filter((name): name is string => typeof name === 'string')
    .map((name) =>
      name
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//u, ''),
    );
};

const hasType = (node: JsonObject, names: ReadonlySet<string>): boolean =>
  typeNames(node).some((name) => names.has(name));

const RECIPE_TYPES: ReadonlySet<string> = new Set([
  'recipe',
  'schema.org/recipe',
  'www.schema.org/recipe',
]);

/** Containers whose `itemListElement` holds the steps, not steps themselves. */
const SECTION_TYPES: ReadonlySet<string> = new Set([
  'howtosection',
  'itemlist',
  'schema.org/howtosection',
  'schema.org/itemlist',
]);

/**
 * Every object a page offers as a candidate, in document order: the value
 * itself, the members of a top-level array, and the members of a `@graph`.
 * Nothing else is walked, so an unrelated nested object never becomes a
 * recipe.
 */
const collectNodes = (value: unknown, out: JsonObject[], depth = 0): void => {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  out.push(value);
  if (value['@graph'] !== undefined) {
    collectNodes(value['@graph'], out, depth + 1);
  }
};

/** The first plain string, allowing JSON-LD's `{ "@value": "…" }` wrapper. */
const firstString = (value: unknown, depth = 0): string | null => {
  if (typeof value === 'string') return value;
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (isObject(value)) return firstString(value['@value'], depth + 1);
  return null;
};

/** `recipeIngredient`: one string, a list of them, or `@value` wrappers. */
const textList = (value: unknown, out: string[], depth = 0): void => {
  if (out.length >= MAX_EXTRACTED_LINES || depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) textList(item, out, depth + 1);
    return;
  }
  const text = firstString(value);
  if (text !== null) out.push(text);
};

/**
 * `recipeInstructions` in document order: plain strings, a `HowToStep`'s
 * `text` (or `name` when it has no text), and the steps inside each
 * `HowToSection`. A section's own heading is not a step, because the accepted
 * design says the steps inside it are.
 */
const collectSteps = (value: unknown, out: string[], depth = 0): void => {
  if (out.length >= MAX_EXTRACTED_LINES || depth > MAX_DEPTH) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSteps(item, out, depth + 1);
    return;
  }
  if (!isObject(value)) return;

  const items = value.itemListElement;
  if (hasType(value, SECTION_TYPES) && items !== undefined) {
    collectSteps(items, out, depth + 1);
    return;
  }
  // An untyped step is common, so the shape decides: text first, then name.
  const text = firstString(value.text) ?? firstString(value.name);
  if (text !== null) {
    out.push(text);
    return;
  }
  if (items !== undefined) collectSteps(items, out, depth + 1);
};

const plainLines = (values: readonly string[]): string[] =>
  values.map(htmlToPlainText).filter((line) => line.length > 0);

/**
 * The first complete `Recipe` on the page, or null when none of the scripts
 * carries a usable name, ingredient, and instruction. An incomplete `Recipe`
 * node does not stop the search: some pages publish a stub alongside the real
 * one.
 */
export const extractRecipeDraft = (
  scripts: readonly string[],
): RecipeDraft | null => {
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script);
    } catch {
      // A page may carry malformed or templated JSON-LD beside a good block.
      continue;
    }

    const nodes: JsonObject[] = [];
    collectNodes(parsed, nodes);

    for (const node of nodes) {
      if (!hasType(node, RECIPE_TYPES)) continue;

      const rawIngredients: string[] = [];
      textList(node.recipeIngredient, rawIngredients);
      const rawSteps: string[] = [];
      collectSteps(node.recipeInstructions, rawSteps);

      const title = htmlToPlainText(firstString(node.name) ?? '');
      const ingredients = plainLines(rawIngredients);
      const steps = plainLines(rawSteps);
      if (title.length === 0 || ingredients.length === 0 || steps.length === 0)
        continue;

      return { title, ingredients, steps };
    }
  }
  return null;
};
