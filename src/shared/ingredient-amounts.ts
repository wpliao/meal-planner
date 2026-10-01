/**
 * Reads the amounts in recipe text and presents them for a chosen number of
 * servings and unit system (#118). It is display only: the saved text never
 * changes, and anything the reader does not recognize is passed through
 * exactly as written, so a gap shows up as an unconverted amount and never as
 * a wrong one. Every expression here is linear: no nested quantifiers.
 */

export type UnitSystem = 'metric' | 'imperial';

export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'metric';

export const isUnitSystem = (value: unknown): value is UnitSystem =>
  value === 'metric' || value === 'imperial';

export type Dimension = 'mass' | 'volume' | 'length' | 'temperature';

export interface Unit {
  readonly dimension: Dimension;
  /** Cups and spoons are `neutral`: they are never converted. */
  readonly system: UnitSystem | 'neutral';
  /** Grams, millilitres, or centimetres per unit; unused for temperature. */
  readonly base: number;
  /**
   * The form a re-formatted amount uses. Without one (cups, spoons, pints),
   * a scaled amount keeps the line's own word.
   */
  readonly short?: string;
}

const UNITS = {
  g: { dimension: 'mass', system: 'metric', base: 1 },
  kg: { dimension: 'mass', system: 'metric', base: 1000 },
  oz: { dimension: 'mass', system: 'imperial', base: 28.3495, short: 'oz' },
  lb: { dimension: 'mass', system: 'imperial', base: 453.592, short: 'lb' },
  ml: { dimension: 'volume', system: 'metric', base: 1 },
  l: { dimension: 'volume', system: 'metric', base: 1000 },
  floz: {
    dimension: 'volume',
    system: 'imperial',
    base: 29.5735,
    short: 'fl oz',
  },
  pint: { dimension: 'volume', system: 'imperial', base: 473.176 },
  quart: { dimension: 'volume', system: 'imperial', base: 946.353 },
  gallon: { dimension: 'volume', system: 'imperial', base: 3785.41 },
  cup: { dimension: 'volume', system: 'neutral', base: 250 },
  tbsp: { dimension: 'volume', system: 'neutral', base: 15 },
  tsp: { dimension: 'volume', system: 'neutral', base: 5 },
  mm: { dimension: 'length', system: 'metric', base: 0.1 },
  cm: { dimension: 'length', system: 'metric', base: 1 },
  in: { dimension: 'length', system: 'imperial', base: 2.54, short: 'in' },
  celsius: { dimension: 'temperature', system: 'metric', base: 1 },
  fahrenheit: { dimension: 'temperature', system: 'imperial', base: 1 },
} as const satisfies Record<string, Unit>;

type UnitKey = keyof typeof UNITS;

// ---------------------------------------------------------------------------
// Numbers

const FRACTION_GLYPHS: Readonly<Record<string, number>> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅕': 1 / 5,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
};
const GLYPHS = Object.keys(FRACTION_GLYPHS).join('');

/**
 * One number: "1 and 1/4", "1 1/2", "1/2", "1½", "1 ½", "1.5", "2", or "½".
 * JavaScript takes the first alternative that matches, so the longer forms
 * come first.
 */
const NUMBER = String.raw`(?:\d+\s+and\s+(?:\d+[/⁄]\d+|[${GLYPHS}])|\d+\s+\d+[/⁄]\d+|\d+[/⁄]\d+|\d+(?:\.\d+)?\s?[${GLYPHS}]|\d+(?:\.\d+)?|[${GLYPHS}])`;

/** The end of a number: not "1,5", "1,000", or a date's "10/02". */
const NUMBER_END = String.raw`(?![.,]?\d|[/⁄]\d)`;

/**
 * A number that is not inside a word, a price, a longer number, a date, or
 * code: "7up", "B12", "$3.99", "1,5", "1,000", "10/02/2026", and the `1"` in
 * `x="1"` are not read. A
 * slash after a unit ("220C/450F") is not a date, so it may come before one.
 */
const NUMBER_RE = new RegExp(
  String.raw`(?<![\p{Script=Latin}\d.,$£€¥#=])(?<!\d[/⁄])${NUMBER}${NUMBER_END}`,
  'gu',
);
const RANGE_RE = new RegExp(
  String.raw`(?:\s*[-–—]\s*|\s+to\s+)(${NUMBER})${NUMBER_END}`,
  'uy',
);
const SIDE_RE = new RegExp(
  String.raw`\s*[x×]\s*(${NUMBER})${NUMBER_END}`,
  'uy',
);

const fractionValue = (text: string): number => {
  const glyph = FRACTION_GLYPHS[text];
  if (glyph !== undefined) return glyph;
  const [top, bottom] = text.split(/[/⁄]/u).map(Number);
  return top !== undefined && bottom ? top / bottom : Number.NaN;
};

/** The value of a string that matched `NUMBER`. */
const parseNumber = (text: string): number => {
  if (/^\d+[/⁄]\d+$/u.test(text)) return fractionValue(text);
  const parts = /^(\d+(?:\.\d+)?)?(?:\s+and\s+|\s*)(.*)$/u.exec(text);
  const whole = parts?.[1] ? Number(parts[1]) : 0;
  const rest = parts?.[2] ?? '';
  return rest === '' ? whole : whole + fractionValue(rest);
};

// ---------------------------------------------------------------------------
// Units

/**
 * Each unit's spellings as a named group. Case is ignored, except that a
 * bare `T` is a tablespoon and `t` a teaspoon, and a bare `C` or `F` must be
 * a capital; those are checked after the match.
 */
const UNIT_PATTERN = [
  String.raw`(?<floz>fl\.?\s?oz|fluid\s+ounces?)`,
  String.raw`(?<kg>kilograms?|kilos?|kgs?)`,
  String.raw`(?<g>grams?|g)`,
  String.raw`(?<oz>ounces?|oz)`,
  String.raw`(?<lb>pounds?|lbs?)`,
  String.raw`(?<ml>millilit(?:re|er)s?|mls?)`,
  String.raw`(?<l>lit(?:re|er)s?|l)`,
  String.raw`(?<pint>pints?|pt)`,
  String.raw`(?<quart>quarts?|qt)`,
  String.raw`(?<gallon>gallons?|gal)`,
  String.raw`(?<cup>cups?)`,
  String.raw`(?<tbsp>tablespoons?|tbsps?|tbs)`,
  String.raw`(?<tsp>teaspoons?|tsps?)`,
  String.raw`(?<spoon>t)`,
  String.raw`(?<mm>millimet(?:re|er)s?|mm)`,
  String.raw`(?<cm>centimet(?:re|er)s?|cm)`,
  String.raw`(?<in>inch(?:es)?|in|")`,
  String.raw`(?<celsius>[°º˚]\s?c(?:elsius)?|degrees?\s+c(?:elsius)?)`,
  String.raw`(?<fahrenheit>[°º˚]\s?f(?:ahrenheit)?|degrees?\s+f(?:ahrenheit)?)`,
  String.raw`(?<bareC>c)`,
  String.raw`(?<bareF>f)`,
].join('|');

/**
 * The unit after a number: an optional space or hyphen ("28-ounce",
 * "9x13-inch"), the unit, and the end of the word.
 */
const UNIT_RE = new RegExp(
  String.raw`(\s?-?\s?)(?:${UNIT_PATTERN})(?![\p{L}\p{N}])`,
  'iuy',
);

/**
 * An abbreviation's period belongs to it when the line goes on in lower case
 * ("1 lb. beef"), not when it ends a sentence. It is matched without the `i`
 * flag, under which `\p{Lu}` would match every letter.
 */
const ABBREVIATION_PERIOD_RE = /^\.(?=\s+[^\s\p{Lu}])/u;

type ReadContext = 'ingredient' | 'step';

interface UnitMatch {
  readonly unit: Unit;
  /** The unit as written, without the separator. */
  readonly text: string;
  readonly separator: string;
  readonly end: number;
}

const unitKey = (
  name: string,
  raw: string,
  separator: string,
  context: ReadContext,
): UnitKey | null => {
  switch (name) {
    case 'spoon':
      return raw === 'T' ? 'tbsp' : 'tsp';
    case 'bareC':
    case 'bareF':
      // Only in steps, and only a capital directly after the number
      // ("220C/450F"): some ingredient lines write "C" for cups.
      if (context !== 'step' || separator !== '') return null;
      if (raw === 'C') return 'celsius';
      return raw === 'F' ? 'fahrenheit' : null;
    case 'in':
      // "9in", "9-inch", and "9 inches" are lengths; "2 in the pan" and a
      // spaced `"` are not.
      if (separator !== '' && /^(?:in|")$/iu.test(raw)) return null;
      return 'in';
    default:
      return name in UNITS ? (name as UnitKey) : null;
  }
};

const readUnit = (
  text: string,
  at: number,
  context: ReadContext,
): UnitMatch | null => {
  UNIT_RE.lastIndex = at;
  const match = UNIT_RE.exec(text);
  if (!match?.groups) return null;
  const separator = match[1] ?? '';
  const named = Object.entries(match.groups).find(
    ([, value]) => value !== undefined,
  );
  if (!named) return null;
  const raw = named[1] ?? '';
  const key = unitKey(named[0], raw, separator, context);
  if (!key) return null;
  const end = at + match[0].length;
  const period =
    /\p{L}$/u.test(raw) && ABBREVIATION_PERIOD_RE.test(text.slice(end)) ? 1 : 0;
  return {
    unit: UNITS[key],
    text: text.slice(at + separator.length, end + period),
    separator,
    end: end + period,
  };
};

// ---------------------------------------------------------------------------
// Reading

/** One amount found in the text, with its unit if it has one. */
export interface Amount {
  readonly start: number;
  readonly end: number;
  /** One value, a range's two ends, or a size's two or three sides. */
  readonly values: readonly number[];
  readonly shape: 'single' | 'range' | 'size';
  readonly unit: Unit | null;
  /** The unit as written, such as "Tbsp", or "inch" in "28-inch". */
  readonly unitText: string;
  /** What separates the number from its unit: "", " ", or "-". */
  readonly separator: string;
}

/** "9x13" or "21.5 x 11.5 x 7": the sides after the first, if any. */
const readSides = (text: string, at: number) => {
  const sides: number[] = [];
  let end = at;
  while (sides.length < 2) {
    SIDE_RE.lastIndex = end;
    const side = SIDE_RE.exec(text);
    if (!side?.[1]) break;
    sides.push(parseNumber(side[1]));
    end = SIDE_RE.lastIndex;
  }
  return { sides, end };
};

const readAmount = (
  text: string,
  start: number,
  number: string,
  context: ReadContext,
): Amount | null => {
  const first = parseNumber(number);
  let end = start + number.length;
  let values = [first];
  let shape: Amount['shape'] = 'single';

  RANGE_RE.lastIndex = end;
  const range = RANGE_RE.exec(text);
  if (range?.[1]) {
    values = [first, parseNumber(range[1])];
    shape = 'range';
    end = RANGE_RE.lastIndex;
  } else {
    // A size has sides only when it is a length: "1 x 400 g" is a pack.
    const { sides, end: sidesEnd } = readSides(text, end);
    if (
      sides.length > 0 &&
      readUnit(text, sidesEnd, context)?.unit.dimension === 'length'
    ) {
      values = [first, ...sides];
      shape = 'size';
      end = sidesEnd;
    }
  }
  if (!values.every((value) => Number.isFinite(value))) return null;

  const unit = readUnit(text, end, context);
  // A number run into a word ("3rd", "2cloves") is not an amount.
  if (!unit && /^\p{L}/u.test(text.slice(end))) return null;
  return {
    start,
    end: unit?.end ?? end,
    values,
    shape,
    unit: unit?.unit ?? null,
    unitText: unit?.text ?? '',
    separator: unit?.separator ?? '',
  };
};

const scanAmounts = (text: string, context: ReadContext): Amount[] => {
  const amounts: Amount[] = [];
  NUMBER_RE.lastIndex = 0;
  for (let match = NUMBER_RE.exec(text); match; match = NUMBER_RE.exec(text)) {
    const amount = readAmount(text, match.index, match[0], context);
    if (amount) {
      amounts.push(amount);
      NUMBER_RE.lastIndex = amount.end;
    }
  }
  return amounts;
};

/**
 * Amounts that state the same quantity, next to each other: "1 kg / 2 lb",
 * "1 cup (250 ml)", "3/4 cup (12 Tbsp; 170g)", "180°C/350°F", or
 * "100 g / 1 stick".
 */
interface Group {
  readonly members: readonly Amount[];
  readonly start: number;
  readonly end: number;
}

const OPEN_RE = /^\s*\(\s*$/u;
const INSIDE_SEPARATOR_RE = /^\s*(?:[;,/–—-]|or)\s*$/iu;
const SLASH_RE = /^\s*\/\s*$/u;
const OR_RE = /^\s*or\s*$/iu;
const CLOSE_RE = /^\s*\)/u;

/** Unit amounts in parentheses directly after `head`, closed after the last. */
const parenthesized = (
  text: string,
  amounts: readonly Amount[],
  index: number,
): Group | null => {
  const head = amounts[index];
  const inside: Amount[] = [];
  let between = OPEN_RE;
  for (let at = index + 1; at < amounts.length; at += 1) {
    const next = amounts[at];
    const previous = inside.at(-1) ?? head;
    if (!next.unit || !between.test(text.slice(previous.end, next.start))) {
      break;
    }
    inside.push(next);
    between = INSIDE_SEPARATOR_RE;
  }
  const last = inside.at(-1);
  const close = last && CLOSE_RE.exec(text.slice(last.end));
  if (!last || !close) return null;
  return {
    members: [head, ...inside],
    start: head.start,
    end: last.end + close[0].length,
  };
};

/** Amounts after `head` joined by "/" or "or". A count may follow a "/". */
const joined = (
  text: string,
  amounts: readonly Amount[],
  index: number,
): Group => {
  const members = [amounts[index]];
  for (let at = index + 1; at < amounts.length; at += 1) {
    const next = amounts[at];
    const between = text.slice((members.at(-1) as Amount).end, next.start);
    const fits = next.unit
      ? SLASH_RE.test(between) || OR_RE.test(between)
      : SLASH_RE.test(between);
    if (!fits) break;
    members.push(next);
  }
  const head = members[0];
  return { members, start: head.start, end: (members.at(-1) as Amount).end };
};

const groupAmounts = (text: string, amounts: readonly Amount[]): Group[] => {
  const groups: Group[] = [];
  let index = 0;
  while (index < amounts.length) {
    const head = amounts[index];
    const group = head.unit
      ? (parenthesized(text, amounts, index) ?? joined(text, amounts, index))
      : { members: [head], start: head.start, end: head.end };
    groups.push(group);
    index += group.members.length;
  }
  return groups;
};

const LEADING_RE = /^\s*(?:[-•*·]\s*)?$/u;

/** What the reader found in an ingredient line. */
export interface ReadLine {
  readonly amounts: readonly Amount[];
  /** The amount the line starts with, which servings scale. */
  readonly leading: Amount | null;
}

export const readIngredientLine = (line: string): ReadLine => {
  const amounts = scanAmounts(line, 'ingredient');
  const first = amounts[0];
  const leading =
    first && LEADING_RE.test(line.slice(0, first.start)) ? first : null;
  return { amounts, leading };
};

/** Steps are read for temperatures and lengths only. */
export const readStepText = (text: string): readonly Amount[] =>
  scanAmounts(text, 'step').filter(
    ({ unit }) =>
      unit?.dimension === 'temperature' || unit?.dimension === 'length',
  );

// ---------------------------------------------------------------------------
// Rounding and formatting

const roundTo = (value: number, step: number) =>
  Math.round(value / step) * step;

/** A metric number: at most one decimal place, without a trailing zero. */
const decimal = (value: number) => String(Number(value.toFixed(1)));

/** Imperial, cup, spoon, and count amounts round to these fractions. */
const FRACTIONS: readonly (readonly [number, string])[] = [
  [0, ''],
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
  [1, ''],
];

/** The nearest whole or fraction; never 0, so a small amount reads "⅛". */
const fractionText = (value: number): string => {
  const whole = Math.floor(value);
  const rest = value - whole;
  let best = FRACTIONS[0];
  for (const candidate of FRACTIONS) {
    if (Math.abs(candidate[0] - rest) < Math.abs(best[0] - rest)) {
      best = candidate;
    }
  }
  const total = whole + (best[0] === 1 ? 1 : 0);
  const glyph = best[1];
  if (total === 0) return glyph || '⅛';
  return glyph ? `${total} ${glyph}` : String(total);
};

/** Imperial: fractions below 1, otherwise to the nearest `step`. */
const imperialText = (value: number, step: number) =>
  value < 1 ? fractionText(value) : fractionText(roundTo(value, step));

const metricRound = (base: number): number => {
  if (base < 10) return Math.max(roundTo(base, 0.5), 0.5);
  if (base < 100) return roundTo(base, 1);
  return roundTo(base, 5);
};

/** Numbers in their new unit, before the ends or sides are joined. */
interface Formatted {
  readonly numbers: readonly string[];
  readonly unit: string;
  /** Temperatures sit against their number: "190°C". */
  readonly tight: boolean;
}

/** `values` are grams, millilitres, centimetres, or degrees Celsius. */
const formatMetric = (
  dimension: Dimension,
  values: readonly number[],
): Formatted => {
  const largest = Math.max(...values);
  if (dimension === 'temperature') {
    return {
      numbers: values.map((value) =>
        String(value >= 100 ? roundTo(value, 10) : Math.round(value)),
      ),
      unit: '°C',
      tight: true,
    };
  }
  if (dimension === 'length') {
    if (largest < 1) {
      return {
        numbers: values.map((value) =>
          String(Math.max(Math.round(value * 10), 1)),
        ),
        unit: 'mm',
        tight: false,
      };
    }
    return {
      numbers: values.map((value) =>
        decimal(value < 10 ? roundTo(value, 0.5) : Math.round(value)),
      ),
      unit: 'cm',
      tight: false,
    };
  }
  const [small, large] = dimension === 'mass' ? ['g', 'kg'] : ['ml', 'l'];
  if (metricRound(largest) >= 1000) {
    return {
      numbers: values.map((value) =>
        decimal(Math.max(roundTo(value / 1000, 0.1), 0.1)),
      ),
      unit: large,
      tight: false,
    };
  }
  return {
    numbers: values.map((value) => decimal(metricRound(value))),
    unit: small,
    tight: false,
  };
};

/** `values` are grams, millilitres, centimetres, or degrees Fahrenheit. */
const formatImperial = (
  dimension: Dimension,
  values: readonly number[],
): Formatted => {
  switch (dimension) {
    case 'temperature':
      return {
        numbers: values.map((value) =>
          String(value >= 200 ? roundTo(value, 25) : roundTo(value, 5)),
        ),
        unit: '°F',
        tight: true,
      };
    case 'length':
      return {
        numbers: values.map((value) => imperialText(value / 2.54, 0.5)),
        unit: 'in',
        tight: false,
      };
    case 'volume':
      return {
        numbers: values.map((value) => imperialText(value / 29.5735, 0.5)),
        unit: 'fl oz',
        tight: false,
      };
    case 'mass': {
      const ounces = values.map((value) => value / 28.3495);
      if (roundTo(Math.max(...ounces), 0.5) >= 16) {
        return {
          numbers: ounces.map((value) =>
            fractionText(Math.max(roundTo(value / 16, 0.25), 0.25)),
          ),
          unit: 'lb',
          tight: false,
        };
      }
      return {
        numbers: ounces.map((value) => imperialText(value, 0.5)),
        unit: 'oz',
        tight: false,
      };
    }
  }
};

const PLURALS: Readonly<Record<string, string>> = {
  cup: 'cups',
  tablespoon: 'tablespoons',
  teaspoon: 'teaspoons',
  pint: 'pints',
  quart: 'quarts',
  gallon: 'gallons',
};
const SINGULARS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PLURALS).map(([one, many]) => [many, one]),
);

/**
 * A unit word agrees with its new amount ("2 cups", "½ cup"); abbreviations
 * such as "tbsp" and "T" stay as written.
 */
const agree = (word: string, values: readonly number[]) => {
  const lower = word.toLowerCase();
  const swapped = Math.max(...values) > 1 ? PLURALS[lower] : SINGULARS[lower];
  if (!swapped) return word;
  return /^\p{Lu}/u.test(word)
    ? `${swapped.charAt(0).toUpperCase()}${swapped.slice(1)}`
    : swapped;
};

const toCelsius = (fahrenheit: number) => ((fahrenheit - 32) * 5) / 9;
const toFahrenheit = (celsius: number) => (celsius * 9) / 5 + 32;

interface Presented {
  readonly text: string;
  readonly converted: boolean;
  readonly scaled: boolean;
}

/** Ranges use an en dash and show one value when both ends round alike. */
const joinNumbers = (amount: Amount, numbers: readonly string[]) => {
  if (amount.shape === 'size') return numbers.join(' x ');
  if (amount.shape === 'range' && numbers[0] !== numbers[1]) {
    return numbers.join('–');
  }
  return numbers[0] ?? '';
};

const formatAmount = (
  amount: Amount,
  unit: Unit,
  values: readonly number[],
  converting: boolean,
  system: UnitSystem,
): Formatted => {
  if (unit.dimension === 'temperature') {
    return system === 'metric'
      ? formatMetric('temperature', values.map(toCelsius))
      : formatImperial('temperature', values.map(toFahrenheit));
  }
  const bases = values.map((value) => value * unit.base);
  if (converting) {
    return system === 'metric'
      ? formatMetric(unit.dimension, bases)
      : formatImperial(unit.dimension, bases);
  }
  // Scaled in its own system: metric is re-rounded and may become kg or l;
  // imperial, cups, and spoons keep their unit.
  if (unit.system === 'metric') return formatMetric(unit.dimension, bases);
  return {
    numbers: values.map(fractionText),
    unit: unit.short ?? agree(amount.unitText, values),
    tight: false,
  };
};

const presentAmount = (
  text: string,
  amount: Amount,
  factor: number,
  system: UnitSystem,
): Presented => {
  const { unit } = amount;
  const scaling = factor !== 1 && unit?.dimension !== 'temperature';
  const converting =
    unit !== null && unit.system !== 'neutral' && unit.system !== system;
  if (!scaling && !converting) {
    return {
      text: text.slice(amount.start, amount.end),
      converted: false,
      scaled: false,
    };
  }
  const values = amount.values.map((value) =>
    scaling ? value * factor : value,
  );
  if (!unit) {
    return {
      text: joinNumbers(amount, values.map(fractionText)),
      converted: false,
      scaled: true,
    };
  }
  const formatted = formatAmount(amount, unit, values, converting, system);
  const space = formatted.tight ? '' : ' ';
  return {
    text: `${joinNumbers(amount, formatted.numbers)}${space}${formatted.unit}`,
    converted: converting,
    scaled: scaling,
  };
};

/**
 * A group shows only its members in the chosen system when it states the
 * same quantity in both: "1 kg / 2 lb" reads "1 kg" in Metric. A member with
 * no peer in the chosen system is kept and converted.
 */
const keptMembers = (group: Group, system: UnitSystem): readonly Amount[] =>
  group.members.filter(
    (member) =>
      member.unit?.system !== (system === 'metric' ? 'imperial' : 'metric') ||
      !group.members.some(
        (peer) =>
          peer.unit?.system === system &&
          peer.unit.dimension === member.unit?.dimension,
      ),
  );

interface GroupRules {
  readonly factorOf: (group: Group) => number;
  /** Whether a changed group is shown in parentheses. */
  readonly bracket: (group: Group) => boolean;
}

const presentGroups = (
  text: string,
  groups: readonly Group[],
  { factorOf, bracket }: GroupRules,
  system: UnitSystem,
): Presented => {
  let out = '';
  let at = 0;
  let converted = false;
  let scaled = false;
  for (const group of groups) {
    const factor = factorOf(group);
    const present = (amount: Amount) => {
      const result = presentAmount(text, amount, factor, system);
      converted ||= result.converted;
      scaled ||= result.scaled;
      return result.text;
    };
    // Each member in place, with the text between them as written.
    const inPlace = (
      members: readonly Amount[],
      start: number,
      end: number,
    ) => {
      let part = '';
      let cursor = start;
      for (const member of members) {
        part += text.slice(cursor, member.start) + present(member);
        cursor = member.end;
      }
      return part + text.slice(cursor, end);
    };
    out += text.slice(at, group.start);
    const kept = keptMembers(group, system);
    const first = kept[0];
    const last = kept.at(-1);
    let part = '';
    if (kept.length === group.members.length) {
      part = inPlace(kept, group.start, group.end);
    } else if (first && last) {
      // Showing only the chosen system's half counts as converting.
      converted = true;
      const span =
        group.members.indexOf(last) - group.members.indexOf(first) + 1;
      part =
        span === kept.length
          ? inPlace(kept, first.start, last.end)
          : kept.map(present).join(' / ');
    }
    const changed = part !== text.slice(group.start, group.end);
    out += changed && bracket(group) ? `(${part})` : part;
    at = group.end;
  }
  out += text.slice(at);
  return { text: out, converted, scaled };
};

export interface PresentOptions {
  /** The chosen servings over the recipe's own; 1 scales nothing. */
  readonly factor: number;
  readonly system: UnitSystem;
}

/** Text as the recipe page shows it. */
export interface PresentedText {
  readonly text: string;
  /** The text differs from what was written. */
  readonly changed: boolean;
  /** An amount was converted to the chosen system. */
  readonly converted: boolean;
  /** An amount was scaled for the chosen servings. */
  readonly scaled: boolean;
}

const finish = (original: string, presented: Presented): PresentedText => {
  const changed = presented.text !== original;
  return {
    text: changed ? presented.text : original,
    changed,
    converted: changed && presented.converted,
    scaled: changed && presented.scaled,
  };
};

/**
 * Scales the line's leading amount and the amounts that restate it by
 * `factor`, and converts amounts outside `system`. Pack sizes and other
 * amounts convert but never scale.
 */
export const presentIngredientLine = (
  line: string,
  { factor, system }: PresentOptions,
): PresentedText => {
  const { amounts, leading } = readIngredientLine(line);
  // A size straight after a leading count ("1 15oz. can") is shown in
  // parentheses once it changes, so "1 (425 g) can" cannot read as 1425 g.
  const packSize = (group: Group) =>
    leading !== null &&
    leading.unit === null &&
    group.members[0] !== leading &&
    /^\s+$/u.test(line.slice(leading.end, group.start));
  return finish(
    line,
    presentGroups(
      line,
      groupAmounts(line, amounts),
      {
        factorOf: (group) => (group.members[0] === leading ? factor : 1),
        bracket: packSize,
      },
      system,
    ),
  );
};

/** Converts temperatures and lengths in a step; steps are never scaled. */
export const presentStepText = (
  text: string,
  { system }: Pick<PresentOptions, 'system'>,
): PresentedText =>
  finish(
    text,
    presentGroups(
      text,
      groupAmounts(text, readStepText(text)),
      { factorOf: () => 1, bracket: () => false },
      system,
    ),
  );
