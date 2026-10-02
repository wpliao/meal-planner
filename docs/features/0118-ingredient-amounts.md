# Feature: Scale ingredient amounts by servings and switch metric/imperial

- Status: Implementing
- Phase: 3 follow-up
- Issue: https://github.com/wpliao/meal-planner/issues/118
- Product owner: wpliao
- Last updated: 2026-10-02
- Pull requests: [#119](https://github.com/wpliao/meal-planner/pull/119) (design), [#121](https://github.com/wpliao/meal-planner/pull/121) (implementation), [#123](https://github.com/wpliao/meal-planner/pull/123) (layout fix)

## Problem and outcome

Most supported recipe sites are American, so their imported ingredients read
"1 lb chicken thighs", "8 oz cheddar", or "bake at 375°F". The family cooks in
metric. They also cook for a different number of people than a recipe serves,
so they work out the amounts by hand.

Outcome: the recipe page shows amounts for the number of servings a member
chooses, in metric or imperial units, with a switch between the two that
starts on Metric. The saved recipe never changes. Only the page's display
does, and only for amounts the app can read with certainty. Everything else
is shown exactly as written.

## User scenarios

1. Given an imported recipe that serves 4 and reads "1 lb chicken thighs",
   when a member opens it, then the line reads "455 g chicken thighs".
2. Given the same recipe, when the member sets **Servings** to 6, then the
   line reads "680 g chicken thighs", and "2 eggs" reads "3 eggs".
3. Given a member who prefers imperial, when they choose **Imperial** on any
   recipe, then "500 g beef mince" reads "1 lb beef mince". Every recipe they
   open on that device stays on Imperial until they switch back.
4. Given a step "Bake at 375°F in a 9x13-inch pan", when the page is on
   Metric, then it reads "Bake at 190°C in a 23 x 33 cm pan".
5. Given a line the reader cannot interpret, such as "salt and pepper to
   taste" or "a handful of basil", then it is shown exactly as written, at any
   servings and in either system.
6. Given a recipe without a servings count, when a member chooses **2×**, then
   the readable amounts are doubled.

## Scope

- **Included:**
  - a deterministic amount reader for ingredient lines;
  - servings scaling of each line's leading amount on the recipe page;
  - a Metric / Imperial display switch, remembered per device;
  - conversion of temperatures and pan sizes in steps;
  - documented rounding.
- **Not included:**
  - changing the saved text;
  - converting volume to weight (cups of flour to grams);
  - converting cups and spoons;
  - scaling amounts mentioned in steps;
  - scaling planned meals or the meal plan's nutrition;
  - pluralizing or singularizing the words after an amount;
  - AI interpretation of lines.

## Acceptance criteria

Identifiers are stable after the design is accepted. Mark changed or superseded
criteria and explain the change in the decision log; do not silently renumber or
delete them.

- [ ] `AC-01`: A shared, deterministic reader finds amounts in an ingredient
      line using the [reading rules](#reading-rules).
  - An amount is a number, a fraction, a mixed number, or a range.
  - It may be followed by a unit from the [unit table](#unit-table).
  - The reader also finds a paired equivalent such as "500 g / 1 lb", and
    a pack form such as "1 x 400 g can".
  - Text it does not recognize is passed through unchanged. It never
    invents an amount or a unit.
- [ ] `AC-02`: The recipe page has a servings control.
  - When the recipe has a servings count, the control chooses 1–50
    servings, starting at the recipe's count.
  - Otherwise it offers ½×, 1×, 2×, 3×, and 4×, starting at 1×.
  - Changing it scales each ingredient line's leading amount and its
    paired equivalent by the chosen factor. Pack sizes and all other
    numbers are left as written.
  - Steps are not scaled, and a note says so whenever the factor is not 1.
  - Per-serving nutrition is unchanged.
- [ ] `AC-03`: The recipe page has a **Units** switch, Metric or Imperial.
  - It starts on Metric and is remembered on the device. When the device
    cannot store it, the page still works, starting on Metric.
  - Metric converts the imperial units in the unit table to metric, in
    ingredients and in step temperatures and lengths. Imperial does the
    reverse.
  - Cups, tablespoons, teaspoons, counts, and unknown units are never
    converted.
  - A line with a paired equivalent shows only the amount in the chosen
    system.
- [ ] `AC-04`: Converted and scaled amounts follow the [rounding
      rules](#rounding-rules). The same line, factor, and system always give
      the same text.
- [ ] `AC-05`: The adjustment is display only.
  - The saved recipe, its version, the editor, the nutrition review, and
    the ingredient matches are unchanged.
  - When the page shows any amount differently from the saved text, a
    note says the amounts are adjusted and rounded, and that **Edit
    recipe** shows them as written.
- [ ] `AC-06`: The controls are labelled, keyboard operable, and at least 44px
      high. A change is announced politely, and the page fits a phone in one
      column.
- [ ] `AC-07`: Deterministic unit tests cover the reader, conversion,
      scaling, and rounding with a table of real lines from each supported
      site. Client and browser tests cover the controls and the remembered
      units.

## Experience design

**Where.** At the top of the **Ingredients** section on the recipe page, above
the list, there is a row of two controls. They wrap to two rows on a phone.

- **Servings:**
  - With a servings count: a number control labelled "Servings", with −
    and + buttons, from 1 to 50, starting at the recipe's count. When it
    differs from the recipe's count, a **Reset** button appears. The
    existing "Serves 4" line stays as the recipe's own count.
  - Without a count: a segmented control labelled "Scale", with ½×, 1×, 2×,
    3×, and 4×.
- **Units:** a segmented control labelled "Units", with Metric and Imperial.
  It is stored in `localStorage` under `meal-planner:units`. Reads and writes
  are wrapped so that a blocked store falls back to Metric for this visit.
- **Notes,** below the ingredient list, only when they apply:
  - "Amounts are adjusted for 6 servings and rounded. Edit recipe shows them
    as written." (or "…converted to metric and rounded…", or both).
  - "Amounts in the steps are for 4 servings." when the factor is not 1. With
    no servings count, it says "…for the original recipe." A scale reads
    "Amounts are scaled to 2× and rounded…".
- **Not remembered:** servings are chosen per visit. Opening the recipe again
  starts at its own count.
- **Announcements:** a change to servings or units updates a polite live
  region, for example "Showing amounts for 6 servings, in metric."
- **Elsewhere:** the editor, the import review, and the nutrition review keep
  showing the saved text. Adjusting is what the recipe page is for, while
  those screens edit or match the written line.

## Reading rules

The reader is `readIngredientLine(line)` in a new
`src/shared/ingredient-amounts.ts`. It is pure, so client tests and unit tests
share it. It finds the following.

- **Numbers:**
  - whole numbers such as `2`;
  - decimals such as `1.5` (a comma decimal such as `1,5` is not read);
  - simple fractions such as `1/2`;
  - mixed numbers such as `1 1/2`, `1½`, or `1 ½`;
  - the Unicode fractions ½ ⅓ ⅔ ¼ ¾ ⅕ ⅛ ⅜ ⅝ ⅞.
- **Ranges:** two numbers joined by `-`, `–`, or `to`, such as `2-3` or `2
to 3`. A range scales and converts end by end.
- **Units:** an amount is optionally followed by a unit from the [unit
  table](#unit-table), with or without a space, in any case. A trailing `.` is
  allowed.
- **Leading amount:** the first amount in the line, if the line starts with it
  after an optional bullet or space. Only the leading amount, and its pair,
  scale.
- **Paired equivalent:** a second amount with a unit of the same kind
  (mass, volume, length, or temperature) directly after the leading amount.
  It can be in one of three forms:
  - in parentheses: `1 lb (450 g)`;
  - after a slash: `500g / 1 lb`;
  - after "or": `250 ml or 1 cup`.
- **Pack form:** `N x SIZE` or `N (SIZE)`, for example `1 x 400 g can` or `2
(14 oz) cans`. `N` is the leading amount and scales. `SIZE` is a separate
  amount that converts but never scales.
- **Other amounts:** any further amount with a unit is converted but never
  scaled. For example, "about 8 oz" in "1 bag (about 8 oz) spinach".
- **Steps:** only temperatures and lengths are read. For example `375°F`,
  `375 °F`, `375 degrees F`, `190°C`, `9x13-inch`, `9 x 13 inch`, and `23 cm`.
- **Not read:**
  - numbers without a unit anywhere except the leading position;
  - numbers right after a letter, digit, or one of `. , $ £ € ¥ # =`, such as
    "7up", "B12", "$3.99", "1,000", or the `1"` in `x="1"`;
  - dates such as "10/02/2026";
  - `in` and `"` with a space before them, so "leave 2 in the pan" is not
    2 inches (but "9in" and "2 inches" are);
  - a bare `C` or `F` that is lowercase or has a space before it.

  Anything else is passed through as text.

### Unit table

| Kind        | Metric units                                                   | Imperial (US customary) units                                                    | Never converted                                                   |
| ----------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Mass        | `g`, `gram(s)`, `kg`, `kilogram(s)`                            | `oz`, `ounce(s)`, `lb(s)`, `pound(s)`                                            | —                                                                 |
| Volume      | `ml`, `mL`, `millilitre(s)`, `l`, `L`, `litre(s)`              | `fl oz`, `fluid ounce(s)`, `pint(s)`, `pt`, `quart(s)`, `qt`, `gallon(s)`, `gal` | `cup(s)`, `tbsp`, `tablespoon(s)`, `tsp`, `teaspoon(s)`, `T`, `t` |
| Length      | `mm`, `cm`                                                     | `inch(es)`, `in`, `"`                                                            | —                                                                 |
| Temperature | `°C`, `degrees C`, and in steps only a bare `C` after a number | `°F`, `degrees F`, and in steps only a bare `F` after a number                   | —                                                                 |
| Count       | —                                                              | —                                                                                | no unit, or any other word                                        |

Factors:

- 1 oz = 28.3495 g; 1 lb = 453.592 g.
- 1 US fl oz = 29.5735 ml; pint = 473.176 ml; quart = 946.353 ml; gallon =
  3,785.41 ml.
- 1 inch = 2.54 cm.
- °C = (°F − 32) × 5 / 9.

US measures are used because the supported imperial sites are American.
`oz` is always read as mass. Only `fl oz` is volume. A bare `C` is not read in ingredient lines, where some recipes use it for cups.

### Rounding rules

Rounding happens once, after scaling and converting from the exact value.

- **Metric mass and volume:**
  - below 10: to the nearest 0.5, and never less than 0.5;
  - below 100: to the nearest 1;
  - below 1,000: to the nearest 5;
  - from 1,000: to the nearest 0.1 of `kg` or `l`. So "1.4 kg", and 1,000 g
    reads "1 kg".
- **Metric length:** below 1 cm, in `mm`, to the nearest 1 mm; below 10 cm,
  to the nearest 0.5 cm; otherwise to the nearest 1 cm. So ¼ inch reads
  "6 mm".
- **°C:** to the nearest 10 from 100 °C, otherwise to the nearest 1. So 350 °F
  reads 180 °C and 375 °F reads 190 °C.
- **Imperial mass:** below 1 lb, in `oz`, to the nearest ½. From 1 lb, in `lb`,
  to the nearest ¼. So 500 g reads "1 lb" and 1 kg reads "2 ¼ lb".
- **Imperial volume:** in `fl oz`, to the nearest ½.
- **Imperial length:** to the nearest ½ inch.
- **Below 1 imperial unit** (oz, fl oz, or inch), the nearest fraction from
  the list below, never 0. So 5 g reads "⅛ oz" and 6 mm reads "¼ in".
- **A range** chooses its unit by its larger end, so "800-1200 g" reads
  "1 ¾–2 ¾ lb" and both ends use the same unit.
- **°F:** to the nearest 25 from 200 °F, otherwise to the nearest 5. So 180 °C
  reads 350 °F and 200 °C reads 400 °F.
- **Scaled amounts that are not converted** (counts, cups, spoons, or an
  amount already in the chosen system):
  - Imperial units, cups, spoons, and counts use the nearest of whole, ⅛, ¼,
    ⅓, ⅜, ½, ⅝, ⅔, ¾, and ⅞, so 1 cup × ⅔ reads "⅔ cup". A count is never
    shown as 0.
  - Imperial units keep the line's unit when scaled: 12 oz × 2 reads
    "24 oz".
  - Metric units use the metric rules above, so 800 g × 1.5 reads "1.2 kg".
- **At factor 1 in the line's own system,** an amount is shown exactly as
  written: same digits, spacing, and unit spelling. Only changed amounts are
  re-formatted.
- **Formatting:** a re-formatted amount uses the unit's short form (`g`, `kg`,
  `ml`, `l`, `cm`, `°C`, `oz`, `lb`, `fl oz`, `in`, `°F`) with a space before
  it. Temperatures have no space ("190°C"). A cup or spoon word keeps the
  line's own spelling and agrees with the new amount ("1 ½ cups"), as do
  pint, quart, and gallon. Ranges use an en dash ("2–3").
- **Pack size:** when a converted size follows a bare count with only a space
  between them, it is put in parentheses so the two numbers do not run
  together: "1 15oz. can" reads "1 (425 g) can".

## Technical design

### Boundaries and contracts

- **`src/shared/ingredient-amounts.ts`** (new and pure):
  - `readIngredientLine` and `readStepText` return text and amount segments.
  - `presentIngredientLine(line, { factor, system })` and
    `presentStepText(text, { system })` return `{ text, changed, converted,
scaled }`. The flags choose which note the page shows.
- **`src/client/RecipeAmounts.tsx`** (used by `RecipeDetail.tsx`):
  - `AdjustableRecipeBody` and `usePresentedRecipe`: the servings and units
    controls, with local state for servings;
  - a small `useUnitSystem()` hook over `localStorage`, with try/catch;
  - the notes and the live region.
- **`src/client/RecipeParts.tsx`:** `RecipeBody` takes optional presented
  text, controls, and notes. Other screens pass none and show the saved text.
- **`src/client/mantine.ts`:** the `FloatingIndicator`, `NumberInput`, and
  `SegmentedControl` stylesheets, in Mantine's order.
- **Unchanged:** the recipe API, the Worker, and the database. The page
  receives the same recipe JSON and only formats it.

### Data and migrations

Not applicable: no stored data changes. The unit choice is a per-device
browser preference, not family data.

### Security and privacy

- No new request, endpoint, or third party.
- Presented text is rendered as React text, never as HTML, as recipe text is
  today.
- The reader runs on the client over at most 100 lines of 300 characters, with
  linear-time regular expressions only (no nested quantifiers), so a crafted
  line cannot stall the page.

### Accessibility

- **Labels:** "Servings" (with its − and + buttons named "Fewer servings" and
  "More servings"), "Scale", and "Units".
- **Segmented controls** are radio groups and keyboard operable.
- **Live region:** it announces the state after a change.
- **Notes** are plain text below the list, not colour alone.

### Reliability and observability

- A line the reader cannot read is shown as written, so a reader gap shows up
  as an unconverted amount, never as a wrong one.
- The reader's table of real lines is the regression guard for every supported
  site.

## Test strategy

- **Unit** (`src/shared/ingredient-amounts.test.ts`):
  - a table of at least 40 real ingredient lines and 10 step sentences from
    the six supported sites, including RecipeTin Eats paired lines, each with
    its expected Metric, Imperial, and scaled text;
  - every rounding boundary;
  - ranges, mixed numbers, and Unicode fractions;
  - the pack form;
  - pass-through of unreadable lines;
  - factor 1 leaving lines byte-for-byte unchanged;
  - a long-line performance bound.
- **Client** (`src/client/Recipes.test.tsx`):
  - the servings control and its reset;
  - the scale control without servings;
  - the units switch, remembered across a re-render;
  - storage blocked, falling back to Metric;
  - the notes and announcements;
  - the editor still showing saved text.
- **Browser** (`tests/e2e/recipes.spec.ts`), on desktop and phone:
  - open a recipe with imperial lines and see metric amounts;
  - change servings and see scaled amounts;
  - switch to Imperial, reload, and see Imperial remembered.

## Traceability

| Criterion | Implementation                                                                                                                                                              | Automated tests                                                                                                                                                                                                                                                                                                                                 | Release evidence |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `AC-01`   | `readIngredientLine`, `readStepText`, `scanAmounts`, `groupAmounts` in `src/shared/ingredient-amounts.ts`                                                                   | `src/shared/ingredient-amounts.test.ts`: "presentIngredientLine on real lines", "numbers and ranges", "reading", "passes lines it cannot read through at any factor and system"                                                                                                                                                                 | Pending          |
| `AC-02`   | `usePresentedRecipe` (servings `NumberInput`, Fewer/More/Reset, Scale `SegmentedControl`, steps note) in `src/client/RecipeAmounts.tsx`; `presentIngredientLine` `factorOf` | `src/client/Recipes.test.tsx`: "adjusts amounts for more servings, announces it, and resets", "takes a typed servings count from 1 to 50", "offers a scale when the recipe has no servings count"; `tests/e2e/recipes.spec.ts`: "a member adjusts servings and units on the recipe page"                                                        | Pending          |
| `AC-03`   | `useUnitSystem`, Units `SegmentedControl` in `src/client/RecipeAmounts.tsx`; `presentIngredientLine`, `presentStepText`, `keptMembers`                                      | `src/client/Recipes.test.tsx`: "shows imperial amounts in metric by default and says so", "remembers Imperial on this device", "starts in the remembered system and ignores an unknown value", "falls back to Metric when the browser blocks storage"; `src/shared/ingredient-amounts.test.ts`: "presentStepText on real steps"; E2E as `AC-02` | Pending          |
| `AC-04`   | `formatMetric`, `formatImperial`, `fractionText`, `metricRound` in `src/shared/ingredient-amounts.ts`                                                                       | `src/shared/ingredient-amounts.test.ts`: "rounding", "factor 1 in the line’s own system"                                                                                                                                                                                                                                                        | Pending          |
| `AC-05`   | `AdjustableRecipeBody` (recipe page only); `RecipeBody` `presented` prop in `src/client/RecipeParts.tsx`; amounts note                                                      | `src/client/Recipes.test.tsx`: "adjusts amounts for more servings, announces it, and resets" (no request is sent), "shows a metric recipe exactly as written, without notes"; E2E as `AC-02` (editor shows the saved text)                                                                                                                      | Pending          |
| `AC-06`   | Labels, `aria-labelledby` radio groups, touch-target widths, live region `recipe-amounts-status` in `src/client/RecipeAmounts.tsx`; stylesheets in `src/client/mantine.ts`  | E2E as `AC-02` (44px controls, no sideways scroll, all four projects); `tests/e2e/visual.spec.ts`: "recipe detail"                                                                                                                                                                                                                              | Pending          |
| `AC-07`   | —                                                                                                                                                                           | `src/shared/ingredient-amounts.test.ts` (45 real lines from seven sites, 18 steps, performance bound), `src/client/Recipes.test.tsx` "Recipe amounts (#118)", `tests/e2e/recipes.spec.ts`                                                                                                                                                       | Pending          |

## Rollout and rollback

One implementation pull request, client only, with no migration. V-DEV: the
owner opens an American recipe and a RecipeTin Eats recipe, changes servings
and units, and compares the result with the original pages. Production
follows with the protected-environment approval. Rollback: redeploy the
previous Worker. The stored unit preference is then simply unused.

## Decision and change log

| Date       | Change                 | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                  |
| ---------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 2026-10-01 | Initial proposal       | Family feedback asked for automatic metric conversion with a switch, and for amounts that follow servings. The owner chose: a per-device switch that starts on Metric, cups and spoons kept as they are, and scaling on the recipe page only, as one feature because both rely on the same amount reader. The reader is deterministic rather than AI-based, so adjustments are instant, offline, and testable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [#118](https://github.com/wpliao/meal-planner/issues/118) |
| 2026-10-01 | Accepted               | The owner accepted the design and merged it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | [#119](https://github.com/wpliao/meal-planner/pull/119)   |
| 2026-10-02 | Implementation choices | Running the reader on real lines settled details the design left open; the rules above now record them. Metric lengths below 1 cm read in mm, and amounts below 1 imperial unit use fractions, because "0.5 cm" and "0 in" read badly. ⅜ and ⅝ joined the fractions, so ¾ cup × ½ reads "⅜ cup", not "⅓ cup". A count is never shown as 0. A metric amount in the chosen system is re-rounded after scaling, so it can become kg; an imperial one keeps its unit. Cup, spoon, pint, quart, and gallon words agree with the new amount; other words are still not pluralized ("1 eggs" is accepted). A converted pack size after a bare count is put in parentheses ("1 (425 g) can"). Temperatures are never scaled and have no space. A pair reduced to one side counts as converted, so the note shows. Numbers after a letter, price sign, `#`, or `=` are not read (the last found by the markup E2E, where `pwned=1"` read as an inch), nor are dates, `in` or `"` after a space, or a bare lowercase `c`/`f`. Steps read only temperatures and lengths, as designed. The reader also returns `converted` and `scaled` flags for the note. | [#121](https://github.com/wpliao/meal-planner/pull/121)   |
| 2026-10-02 | Controls aligned       | In development validation the owner found the Servings and Units labels at different heights. Servings was the number field's own label, and the taller segmented control set the row's bottom edge. Both controls now share one label style at the top of equal-height columns, and the stepper is centred against the segmented control. The field keeps its name through `aria-labelledby`. Layout only; no criterion changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [#123](https://github.com/wpliao/meal-planner/pull/123)   |
