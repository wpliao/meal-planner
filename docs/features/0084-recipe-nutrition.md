# Feature: Recipe nutrition with AI-proposed ingredient matches

- Status: Implementing
- Phase: 6 — structured nutrition (with the Phase 7 AI provider boundary)
- Issue: [#84](https://github.com/wpliao/meal-planner/issues/84)
- Product owner: Repository owner
- Last updated: 2026-09-26
- Pull requests: [#85 — design proposal](https://github.com/wpliao/meal-planner/pull/85); [#88 — implementation, part A](https://github.com/wpliao/meal-planner/pull/88); [#89 — load fix](https://github.com/wpliao/meal-planner/pull/89)

## Problem and outcome

The family keeps recipes and plans meals, but cannot see what a meal
contains: how much energy, protein, fat, sugar, or sodium a serving holds.
Ingredient lines are free text such as `2 tbsp soy sauce`
([DATA_MODEL.md](../DATA_MODEL.md#phase-3-recipe-model)), and a recipe has no
servings count, so nothing can be added up. Matching every line to a food by
hand is too much tapping to be worth doing.

The outcome: on a recipe's page, a member taps **Work out nutrition**. AI
proposes, for each ingredient line, a food from a bundled copy of USDA
FoodData Central and an amount. The member reviews the proposals, fixes any
that are wrong, and saves. The recipe page then shows the NZ/AU label panel
per serving and for the whole recipe: energy (kJ, with kcal), protein, fat,
saturated fat, carbohydrate, sugars, dietary fibre, and sodium. It says how
many lines were counted and cites the USDA record behind each food.

Every value is calculated by the Worker from USDA data and confirmed grams.
AI only proposes which food and how much, and a proposal counts only after a
member saves it
([PRODUCT.md](../PRODUCT.md#product-principles): grounded results, human
control).

This is the first Phase 6 feature. It also brings forward the foundation of
Phase 7: a provider-neutral AI boundary through Cloudflare AI Gateway, whose
only use here is ingredient matching. The owner settled ten choices on
2026-09-26, before this design, recorded under
[Resolved design decisions](#resolved-design-decisions). The owner then
chose the recommended option for each of the nine questions the design left
open, and [accepted the design](https://github.com/wpliao/meal-planner/pull/85#issuecomment-5843856770)
on 2026-09-26, with its two ADRs:
[0009](../DECISIONS/0009-nutrition-reference-data.md) for the reference data
and [0010](../DECISIONS/0010-ai-provider-boundary.md) for the AI boundary.
Acceptance authorizes implementation only, not deploying or changing
production, which keep their existing approval gates.

## User scenarios

1. Given a recipe that serves 4, when a member taps **Work out nutrition**,
   then after a few seconds a review list shows each line with a proposed
   food and amount, for example `2 tbsp soy sauce → Soy sauce made from soy
(tamari) · 2 tbsp = 36 g`. When they tap **Save matches**, the page shows
   the panel per serving and for the whole recipe.
2. Given a wrong proposal ("cream" matched to ice cream), when the member
   taps **Change**, searches "cream, heavy", and picks a food, then that line
   uses it. They mark `salt and pepper to taste` as **Don't count**.
3. Given saved matches, when someone later edits an ingredient line, then
   that line's match no longer counts. The page says "1 ingredient changed
   since nutrition was checked" and offers **Check changed lines**, which
   proposes matches for the changed lines only.
4. Given Workers AI's daily allowance is used up, when a member taps **Work
   out nutrition**, then the Gemini fallback answers. If neither can answer,
   the review opens with every line unmatched, says AI matching is not
   available right now, and the member can choose foods by search or try
   again later.
5. Given a recipe with no servings, when its nutrition is shown, then only
   the whole-recipe column appears, with "Add servings to see values per
   serving" and a link to edit the recipe.
6. Given a recipe with saved matches, when the recipe is deleted or the
   household is decommissioned, then its matches are deleted with it. The
   USDA data is shared reference data and is unaffected.
7. Given a revoked member, a non-member, or another household's recipe ID,
   when nutrition is read, proposed, or saved, then nothing is changed or
   disclosed, and no AI provider is called.

## Scope

- Included: an optional servings count on recipes; a pinned, reviewed USDA
  FoodData Central subset (Foundation Foods and SR Legacy) with the eight
  panel nutrients per 100 g and portion gram weights, loaded identically into
  each environment; a food search; AI proposals through AI Gateway, Workers AI
  first and the Gemini API's free tier as fallback, behind a provider
  interface with a deterministic fake for local use and tests; a review list;
  saved matches per ingredient line, with staleness when a line changes; the
  panel on the recipe page, with coverage, citations, and an estimate notice;
  migration `0006`, with the matches table in the household
  decommission inventory; ADRs 0009 and 0010.
- Not included: daily or weekly totals on the meal plan (the next feature);
  nutrition in suggestion ranking; proposed recipe changes for sodium, fat, or
  protein; targets, percentage of daily intake, per-member needs, or any
  medical or dietary advice; branded or NZ-specific products, other databases,
  or member-entered nutrient values; matching automatically on save or import;
  AI meal suggestions or any other generative feature; micronutrients beyond
  the panel; avoided ingredients or dietary exclusions (deferred by the
  owner); a per-100 g column.

## Acceptance criteria

These stable identifiers mirror [issue #84](https://github.com/wpliao/meal-planner/issues/84).

- [ ] `AC-01`: A recipe can record a servings count, set and changed on the
      recipe form. Without one, the page shows whole-recipe values only and
      asks for servings.
- [ ] `AC-02`: The app holds a pinned, reviewed subset of USDA FoodData
      Central (Foundation Foods and SR Legacy): each food's name, FDC ID,
      data type and release, the eight panel nutrients per 100 g, and its
      portion gram weights. It is the same in development and production, and
      members cannot edit it.
- [ ] `AC-03`: **Work out nutrition** sends the recipe title and ingredient
      lines, with candidate foods the Worker selected from the bundled data,
      to Workers AI through AI Gateway. The request falls back to the Gemini
      API's free tier when Workers AI is unavailable, over quota, or returns
      output that fails validation. The Worker accepts only a food ID from the
      candidates it supplied and a bounded amount for each line, or "not
      counted". It discards anything else, including any nutrient value.
- [ ] `AC-04`: Proposals appear in a review list. The member can accept them
      all, change a line's food by searching the bundled data, change its
      amount, or mark it not counted. Nothing is stored or counted until they
      save, and saving is conflict-safe.
- [ ] `AC-05`: The recipe page shows the panel per serving and for the whole
      recipe, energy in kJ with kcal, and "N of M ingredients counted". It
      lists each counted food with a link to its USDA record and a USDA
      citation, and says the values are estimates, not dietary advice. A
      saved match whose ingredient line has since changed or been removed
      does not count, and the page says the nutrition needs checking.
- [ ] `AC-06`: When no AI provider can answer, the member sees a plain message
      and can still match lines by search. An AI failure never changes saved
      matches.
- [ ] `AC-07`: Matches are household-scoped. Non-members and revoked members
      can neither read nor change them, and another household's recipe IDs
      are refused without disclosing anything. Only the recipe title and
      ingredient lines leave Cloudflare, and only to the Gemini fallback.
      Notes, steps, source URLs, and household or member identity are never
      sent. Prompts and responses are not written to Worker logs.
- [ ] `AC-08`: Retention and deletion: deleting a recipe deletes its matches,
      and household decommission removes every match row. No record of which
      member confirmed a match is kept.
- [ ] `AC-09`: Unit tests cover the calculation, the validation of AI output,
      and provider fallback with fake providers. Workers-runtime tests cover
      authorization, household isolation, saving, and staleness. Playwright
      covers the phone journey from **Work out nutrition** to the saved panel
      with a fake provider. No test calls a real AI service.

## Experience design

**Recipe form** (`AC-01`). A **Servings** field follows the title: an
optional whole number from 1 to 50, labelled "Servings (optional)". A
servings change is recipe content, so it bumps the recipe's version like any
other edit. See [decision 6](#resolved-design-decisions) for imports.

**Recipe page, Nutrition section** (`AC-05`). The section sits after the
ingredients and before the steps. Its states:

- **Not worked out:** "Nutrition hasn't been worked out for this recipe." and
  a **Work out nutrition** button.
- **Working:** the button shows a loader and reads "Matching ingredients…". A
  polite status says "This can take up to 30 seconds." The rest of the page
  stays usable.
- **Saved:** a table with rows Energy, Protein, Fat (total), – saturated,
  Carbohydrate, – sugars, Dietary fibre, Sodium, and columns **Per serving**
  and **Whole recipe**. Energy reads `1,850 kJ (442 kcal)`. Grams show one
  decimal place under 10 g and whole numbers above. Sodium shows whole
  milligrams. Under the table:
  - "6 of 8 ingredients counted." Lines marked **Don't count** are named
    ("Not counted: salt and pepper to taste").
  - "Estimated from USDA FoodData Central. Not dietary advice."
  - A collapsed **Sources** list: each counted food's USDA name, linked to its
    FoodData Central page, with its data type and release, and the citation
    "U.S. Department of Agriculture, Agricultural Research Service.
    FoodData Central."
  - **Edit matches**, which opens the review with the saved matches and calls
    no AI.
- **Changed:** when any saved match's line has changed or gone, or a line has
  no match yet, a notice reads "2 ingredients changed since nutrition was
  checked. They aren't counted." with **Check changed lines**. The totals
  count only current matches.
- **No servings:** only the **Whole recipe** column, with "Add servings to see
  values per serving" linking to **Edit recipe**.
- **Missing values:** see [decision 5](#resolved-design-decisions).

**Review list** (`AC-04`, `AC-06`), a full-screen modal on a phone and a
large modal on desktop, titled "Check the matches":

- An intro reads "Suggested by AI. Check each line, then save. Values come
  from USDA FoodData Central, not from AI."
- One card per line being checked, in recipe order. It shows the original
  line in bold, then the proposed food and amount, for example "Soy sauce made
  from soy (tamari) · 2 tbsp = 36 g". Its controls are **Change** (a search
  field over the bundled foods), an amount field with a unit select, and a
  **Don't count** checkbox. A line the AI could not match reads "No match
  yet" with **Choose food**.
- **Check changed lines** lists only the lines that need a check, says
  "5 other ingredients are already checked. Use Edit matches to change
  them.", and never sends the others to AI. **Edit matches** lists every
  line. (Changed at implementation from a collapsed "Already checked" list;
  see the decision log.)
- If no provider answered, a notice at the top reads "AI matching isn't
  available right now. You can choose foods yourself, or try again later."
  with **Try again**.
- A status line under the cards says how many lines are left ("2 left:
  choose a food and amount, or “Don’t count”."). **Save matches** stays
  enabled; with lines left, it turns that line red and moves focus to the
  first incomplete line. (Changed at implementation from a button disabled
  until every line was ready; see the decision log.) **Cancel** discards the
  proposals. Neither action calls AI.
- If the recipe changed while the review was open, saving answers with the
  existing recipe-conflict message ("This recipe was changed by someone
  else…"), and the review reloads with the current lines.

## Technical design

### Boundaries and contracts

The Worker reuses the verified identity and active-membership boundary from
[ADR 0004](../DECISIONS/0004-access-identity-and-household-authorization.md).
Household scope comes from `MemberContext`, never from the URL or body. Every
route answers `401`/`403` before any household statement or AI call, and a
foreign recipe ID is answered like a missing one (`404 not_found`).

New routes:

- `GET /api/recipes/{id}/nutrition` → `{ nutrition: RecipeNutrition }`: the
  servings, each line's state (`counted`, `not_counted`, `unchecked`, or
  `changed`), each match's food and grams, the totals, per-serving values
  when servings are set, coverage, and the sources. The Worker calculates
  every value.
- `POST /api/recipes/{id}/nutrition/proposals`, body
  `{ recipeVersion: number, positions?: number[] }` →
  `{ recipeVersion, provider: 'workers-ai' | 'gemini' | 'fake' | null, proposals: IngredientProposal[] }`.
  Without `positions`, it proposes for every line without a current match. It
  stores nothing. A stale `recipeVersion` answers `409` with the current
  recipe. `provider: null` means no provider answered, and every proposal is
  unmatched (`AC-06`). `fake` is returned only by local development and tests.
  Same-origin and JSON headers are required, as for every mutation.
- `GET /api/nutrition/foods?q=` → up to 20 foods matching the query, with
  their portions. Queries are 2–60 code points.
- `PUT /api/recipes/{id}/nutrition`, body
  `{ recipeVersion, matches: [{ position, line, fdcId | null, quantity, unit }] }`
  → `{ nutrition }`. It replaces the matches for the given positions in one
  batch, guarded by the recipe's version and each line's current text. A
  stale version answers `409`. A food ID that isn't in the reference data, a
  unit the food can't convert, or an amount out of bounds answers `400`. It
  never changes the recipe's content or version, like a preference (#78).

Changed routes: recipe create, update, import preview, and read gain
`servings: number | null`.

Shared contracts, in `src/shared/nutrition.ts`: `NUTRIENTS` (the eight panel
nutrients, their units and USDA nutrient numbers),
`RecipeNutrition`, `IngredientProposal`, `validateNutritionMatches(body)`,
`toGrams(quantity, unit, portions)`, and `calculateNutrition(lines, foods,
servings)`. These are pure functions, shared by the Worker and the unit tests.

**Calculation.** For each counted line: `value = per100g × grams / 100`,
summed per nutrient, and divided by servings for the per-serving column.
Rounding happens once, for display. Energy uses the food's reported kJ;
where only kcal is reported, kJ = kcal × 4.184; where only Atwater energy is
reported (some Foundation foods), that value is used. Which USDA nutrient
numbers feed each row is fixed in `NUTRIENTS` and in ADR 0009.

**Amounts.** An amount is a quantity and a unit: `g`, `kg`, `ml`, `l`,
`tsp`, `tbsp`, `cup`, or one of the food's USDA portions, such as
`1 medium`. Mass units convert directly. Volume units and portions convert
through the food's USDA portion gram weights. A volume unit the food has no
volume portion for can't be converted, and the member enters grams instead.
See [decision 4](#resolved-design-decisions).

### AI proposals (`AC-03`, `AC-06`, `AC-07`)

The boundary is [ADR 0010](../DECISIONS/0010-ai-provider-boundary.md). In
`src/worker/ai/`, a provider interface takes a system instruction, a JSON
user message, and a JSON schema, and returns parsed JSON or a typed failure.
It has three implementations:

- **Workers AI** through the `AI` binding, with `gateway: { id }` so the call
  passes through the environment's AI Gateway, in JSON mode.
- **Gemini** through the same gateway's `google-ai-studio` endpoint, with the
  environment's key from a Worker secret, and structured JSON output.
- **Fake**, used whenever `APP_ENV` is `local` (development server, Vitest,
  and Playwright). It answers deterministically from the test food fixture,
  and can be told to fail. The local configuration has no `AI` binding and no
  Gemini secret, so local runs and tests can never call a real service.

A proposal request runs these steps; see
[decision 3](#resolved-design-decisions):

1. **Read** the lines to propose, from the recipe by ID and household.
2. **Normalize (AI call 1):** for each line, the model returns a USDA-style
   search phrase ("coriander leaves raw" for "a handful of coriander"), a
   quantity, and a unit, or "not a food" (for example "salt to taste" or
   "water").
3. **Search:** the Worker looks up at most 8 candidate foods per line in the
   full-text index, from both the phrase and the line's own words.
4. **Choose (AI call 2):** the model receives the title, the lines, and each
   line's candidates with their portions, and returns, for each line, one
   candidate's FDC ID, a quantity, and a unit, or "not counted".
5. **Validate:** the output must match the schema. Each position must be one
   that was asked for, each FDC ID must be among that line's candidates, each
   unit must convert for that food, and each quantity must be above 0 and at
   most 10,000 g once converted. Anything else leaves that line unmatched,
   and any extra fields, including nutrient values, are ignored. An answer
   that can't be parsed, or fails the schema, counts as a provider failure.

**Fallback.** Each step tries Workers AI first. Gemini is tried when Workers
AI returns an error (including the daily-allowance error), times out after
15 seconds, or fails validation, and only while the environment's
`GEMINI_FALLBACK` variable is `on` and its key is set. If both fail, the
response has `provider: null`. The two steps of one request may be answered
by different providers, and the response names the provider of the second
step.

**What is sent.** Only the recipe title, the lines being proposed, and USDA
food names and portions. Notes, steps, source URLs, recipe IDs, and household
or member identity are never sent (`AC-07`). Recipe lines imported from
websites are untrusted: the instruction tells the model to treat them as data,
and the validation above bounds what an injected instruction could achieve to
a wrong proposal, which the member reviews.

**Models.** See [decision 8](#resolved-design-decisions). The model names
are Worker variables, so a model can be changed by configuration and a
recorded decision, without code.

### Data and migrations

**Migration `0006_add_recipe_nutrition.sql`** (additive):

- `recipes.servings INTEGER` with
  `CHECK (servings IS NULL OR servings BETWEEN 1 AND 50)`. SQLite adds a
  nullable column with a CHECK without rewriting the table.
- `nutrition_dataset`, a singleton row naming the loaded dataset version,
  its USDA releases, its SHA-256, and when it was loaded.
- `nutrition_foods`: `fdc_id INTEGER PRIMARY KEY`, `name`, `data_type`
  (`foundation` or `sr_legacy`), `category`, `release`, and the eight
  nutrients per 100 g as `REAL`, where `NULL` means USDA reports no value.
- `nutrition_food_portions`: `(fdc_id, seq)` primary key, amount, unit name,
  modifier, and gram weight.
- `nutrition_foods_fts`: an FTS5 index over the food names, which D1
  [supports](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
- `recipe_ingredient_matches`: `(recipe_id, position)` primary key,
  `household_id`, `line_text` (the line as it was when confirmed), `fdc_id`
  and `quantity`, `unit`, `grams` (all `NULL` together for **Don't count**),
  and `confirmed_at`. It cascades from `recipes` and `households`, with
  `CHECK`s for the bounds and the all-or-none `NULL` rule. There is no foreign
  key to `nutrition_foods`, so that a future dataset change can't block a
  load. A match whose food is missing counts as `unchecked`.

A match is **current** when a line exists at its position with exactly its
`line_text`. Recipe edits rewrite lines by position, so an edited, moved, or
removed line makes its match stale without a write to the matches table.
Stale rows stay until the next save for that recipe, which deletes them, or
until the recipe is deleted. There is at most one row per line, so at most
100 per recipe and 50,000 per household.

**Reference data.** The four `nutrition_*` tables are global, read-only
reference data, not household data. See
[decisions 1 and 2](#resolved-design-decisions) for how they are loaded and
which foods they hold. Estimated size: about 7,000 foods and 15,000 portions,
a few megabytes of D1 storage (500 MB per database on Workers Free), and
about 30,000 rows written once per environment (100,000 a day allowed).

**Decommission inventory.** `recipe_ingredient_matches` joins
`src/operations/household-decommission/` (`sql.ts` counts, `COUNT_FIELDS`,
`acceptableDeletionChanges`, `EXPECTED_TABLES`, and `procedure.ts`), the
fake Cloudflare and procedure tests, the Workers-runtime decommission test,
and `docs/operations/household-decommission.md`, in the same pull request as
the migration. The reference tables join `EXPECTED_TABLES` as known tables
that hold no household data. A match cascades from both its recipe and its
household, and #78 found that D1 counted such a row once, so the affected-row
count is measured in the Workers runtime before the procedure relies on it.
`test/worker/helpers.ts` clears the matches table, and
[DATA_MODEL.md](../DATA_MODEL.md) and `migrations/README.md` describe the new
tables.

**Rollout order.** The migration runs before the reference-data load, and
both run before the Worker that reads them, as the Deploy workflow already
orders migrations. The previous Worker never reads the new tables or column,
and its recipe updates name their columns, so they leave `servings` alone.
Rolling the Worker back is safe. Rolling back the migration isn't supported:
a forward migration would drop the tables if the feature were retired.

### Cost on Workers Free

- **Worker CPU (10 ms limit):** the AI calls and D1 queries are waiting, not
  CPU. The CPU work is building two prompts of a few kilobytes, parsing two
  answers, and one calculation over at most 100 lines. This is expected to be
  well under #73's typical 5 ms, and is measured in Workers observability
  during development validation.
- **Workers AI (10,000 neurons a day, reset 00:00 UTC):** two calls per
  recipe, estimated at a few hundred neurons each for a 10-line recipe with a
  70B-class model. That allows roughly 10–25 recipes a day before Gemini takes
  over, to be measured during development validation. Workers Free can't be
  billed for Workers AI: over the allowance, calls fail and the fallback
  runs.
- **Gemini free tier:** its quotas change without notice
  ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)). Its
  project must not have billing enabled, so it can't be charged.
- **D1 (5 million rows read a day):** a full-text lookup reads index rows, not
  the table. A proposal reads at most a few thousand rows. The panel reads at
  most 100 matches and their foods.

### Security and privacy

- Each new route is behind identity, active membership, and (for
  `POST`/`PUT`) same-origin and JSON checks. Bodies are validated with fixed
  shapes, bounded sizes, and bound parameters only. The food search is
  reference data but stays member-only.
- **Third parties:** Workers AI runs in Cloudflare. Gemini's unpaid tier lets
  Google use submitted content to improve its products, and lets human
  reviewers read it ([terms](https://ai.google.dev/gemini-api/terms)). The
  owner accepted sending the title and lines. The terms bar use by anyone
  under 18. The owner stated on 2026-09-26 that every household member is an
  adult. If that changes, set `GEMINI_FALLBACK` to `off`, or remove the key,
  and Workers AI alone remains. SECURITY.md records this.
- **Secrets:** `GEMINI_API_KEY` and the gateway's authentication token
  (`AI_GATEWAY_TOKEN`) are Worker secrets per environment, never `VITE_*`,
  never logged, and never shared between development and production
  (ADR 0002). They are optional secrets, so a deploy without them runs with
  Workers AI only.
- **Logs:** the Worker logs only the provider, the outcome, the latency, and
  line counts. It never logs a title, line, prompt, answer, or key. See
  [decision 7](#resolved-design-decisions) for AI Gateway's own logs.
- **Abuse:** a member could spend the day's free allowance. Both tiers are
  hard-capped at no cost, and the family is trusted, so there is no
  per-member rate limit. A request asks for at most 100 lines.
- Matches say which food and how much the household cooks with. They are
  household data, as sensitive as the recipe itself, and aren't logged.

### Accessibility

- The panel is a `<table>` with the caption "Nutrition", row headers for
  nutrients, and column headers for **Per serving** and **Whole recipe**. The
  saturated fat and sugars rows are indented visually, and their row headers
  read "Saturated fat" and "Sugars".
- The working state is announced through a polite `output`. When proposals
  arrive, focus moves to the review's heading.
- Each review card is a `fieldset` whose legend is the ingredient line. Its
  controls are named from it: "Change food for 2 tbsp soy sauce", "Amount",
  "Unit", "Don't count". The food search is a combobox with a labelled result
  list.
- Touch targets are at least 44px. The visual and contrast checks cover the
  panel, the changed notice, and the review, on Chromium and WebKit, at
  desktop and phone sizes.

### Reliability and observability

- A proposal stores nothing, so it is safe to retry, and a failure never
  changes saved matches (`AC-06`). A save is one version-guarded batch and is
  idempotent.
- Timeouts: 15 seconds per provider per step, so a request that falls back
  twice takes at most about a minute. The client waits up to 70 seconds and
  then shows the unavailable notice.
- Workers observability records the provider, the outcome (`ok`, `quota`,
  `timeout`, `invalid`, or `error`), the latency, and the CPU time, without
  content. AI Gateway's analytics count requests, tokens, and errors per
  provider.

## Test strategy

- **Shared unit tests** (`src/shared/nutrition.test.ts`): the calculation,
  per serving and whole, with missing nutrients, kcal-only and Atwater-only
  foods, and rounding; unit conversion through portions, and the units that
  can't convert; staleness from line text; body validation.
- **Worker unit tests** (`src/worker/ai/*.test.ts`): prompt building leaves
  out notes, steps, URLs, and identity; validation discards foreign FDC IDs,
  unknown positions, bad units, out-of-range amounts, extra fields, and
  nutrient values; fallback order and triggers with fake providers (error,
  quota, timeout, invalid), including `GEMINI_FALLBACK` off and a missing key.
- **Workers-runtime tests** (`test/worker/recipe-nutrition.test.ts`), with a
  small food fixture loaded through the real loader code:
  - read, propose (fake provider), and save; the `409` for a stale version or
    changed line; `400` for foods outside the reference data;
  - staleness after a recipe edit, and the pruning of stale rows on save;
  - a save doesn't change the recipe's version or content, and a servings
    change does;
  - revoked members, non-members, requests without a valid Access assertion,
    and another household's recipe IDs are refused before any household
    statement or provider call (a recording provider shows no call), and
    disclose nothing;
  - deleting a recipe deletes its matches, with D1's affected-row count
    measured; no title, line, or prompt in the console.
- The migration test covers `0006` and its CHECKs, including the `NULL`
  cases. The household decommission tests cover the new table.
- **Client tests:** the section's states, the review's controls and **Save
  matches** enabling, and the unavailable notice.
- **Playwright** (`tests/e2e/nutrition.spec.ts`), with the fake provider:
  set servings, **Work out nutrition**, change one food, mark one line
  **Don't count**, save, and read the panel, on a phone viewport; edit a line
  and see the changed notice; plus visual baselines for the panel and the
  review.
- No test calls Workers AI, Gemini, AI Gateway, or USDA. The dataset build
  script is tested against a small CSV fixture.

## Traceability

| Criterion | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Automated tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Release evidence                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `AC-01`   | [`migrations/0006_add_recipe_nutrition.sql`](../../migrations/0006_add_recipe_nutrition.sql) — `recipes.servings`; [`src/shared/recipes.ts`](../../src/shared/recipes.ts) — `validateRecipeServings`, `RECIPE_SERVINGS_MAX`; [`src/worker/data/recipe-repository.ts`](../../src/worker/data/recipe-repository.ts) — `createRecipe`, `updateRecipe`; [`src/worker/import/json-ld.ts`](../../src/worker/import/json-ld.ts) — `servingsFromYield` (decision 6); [`src/client/RecipeEditor.tsx`](../../src/client/RecipeEditor.tsx) — **Servings** field; [`src/client/recipe-client.ts`](../../src/client/recipe-client.ts) — `validateRecipeForm`; [`src/client/RecipeNutrition.tsx`](../../src/client/RecipeNutrition.tsx) — whole-recipe column and "Add servings" | [`test/worker/recipe-nutrition.test.ts`](../../test/worker/recipe-nutrition.test.ts) — `recipe servings` (“stores servings on create and clears them on update”, “refuses servings of %s”), “divides by servings, which a recipe edit sets”; [`test/worker/recipe-import.test.ts`](../../test/worker/recipe-import.test.ts) — `servings from the recipe yield`; [`test/worker/migration.test.ts`](../../test/worker/migration.test.ts) — “bounds servings to 1–50 or NULL”; [`src/client/RecipeEditor.test.tsx`](../../src/client/RecipeEditor.test.tsx) — “saves servings, and explains servings it cannot accept”; [`src/client/recipe-client.test.ts`](../../src/client/recipe-client.test.ts) — “reads servings %j as %s”; [`src/client/RecipeNutrition.test.tsx`](../../src/client/RecipeNutrition.test.tsx) — “shows only the whole recipe without servings, and asks for them” | Pending                                      |
| `AC-02`   | [`scripts/nutrition-dataset-build.ts`](../../scripts/nutrition-dataset-build.ts) (pinned releases and SHA-256); [`src/operations/nutrition-dataset/build.ts`](../../src/operations/nutrition-dataset/build.ts) — `buildDataset`, `EXCLUDED_CATEGORIES`; [`data/nutrition/usda-fdc.json`](../../data/nutrition/usda-fdc.json); [`src/operations/nutrition-dataset/load.ts`](../../src/operations/nutrition-dataset/load.ts) — `loadNutritionDataset`; [`src/operations/nutrition-dataset/statements.ts`](../../src/operations/nutrition-dataset/statements.ts); [`scripts/nutrition-dataset-load.ts`](../../scripts/nutrition-dataset-load.ts); Deploy step “Load … nutrition reference data”; migration `0006` reference tables                                    | [`test/operations/nutrition-dataset.test.ts`](../../test/operations/nutrition-dataset.test.ts) — `CSV`, `dataset build`, `dataset file` (“reads the committed dataset”), `load statements`, `loading`; [`test/worker/migration.test.ts`](../../test/worker/migration.test.ts) — “bounds the reference data and cascades portions from their food”; [`test/worker/helpers.ts`](../../test/worker/helpers.ts) — `loadNutritionFixture` (the load SQL and FTS5 integrity check in the Workers runtime)                                                                                                                                                                                                                                                                                                                                                                                   | Pending (the load in development is `V-DEV`) |
| `AC-03`   | [`src/worker/ai/provider.ts`](../../src/worker/ai/provider.ts) — provider contract; [`src/worker/ai/providers.ts`](../../src/worker/ai/providers.ts) — Workers AI, Gemini, and local fake; [`src/worker/ai/runner.ts`](../../src/worker/ai/runner.ts) — bounded fallback; [`src/worker/ai/nutrition-proposals.ts`](../../src/worker/ai/nutrition-proposals.ts) — two prompts, FTS5 candidates, and validation; [`src/worker/index.ts`](../../src/worker/index.ts) — `handleNutritionProposals`; [`src/client/RecipeNutrition.tsx`](../../src/client/RecipeNutrition.tsx) — Work out nutrition                                                                                                                                                                      | [`test/worker/ai-proposals.test.ts`](../../test/worker/ai-proposals.test.ts) — `nutrition AI payloads`, `provider fallback`; [`test/worker/recipe-nutrition.test.ts`](../../test/worker/recipe-nutrition.test.ts) — `AI proposals`; [`src/client/RecipeNutrition.test.tsx`](../../src/client/RecipeNutrition.test.tsx) — “prefills AI proposals, while saving still requires a separate tap”; [`tests/e2e/nutrition.spec.ts`](../../tests/e2e/nutrition.spec.ts) — “a member works out a recipe’s nutrition and checks a changed line”                                                                                                                                                                                                                                                                                                                                                | Pending V-DEV-B and V-PROD                   |
| `AC-04`   | [`src/client/NutritionReview.tsx`](../../src/client/NutritionReview.tsx) — `NutritionReview`, `FoodSearch`; [`src/client/nutrition-client.ts`](../../src/client/nutrition-client.ts) — `reviewLines`, `isLineReady`, `toMatchInput`; [`src/shared/nutrition.ts`](../../src/shared/nutrition.ts) — `validateSaveNutritionMatches`, `toGrams`, `unitsFor`, `foodSearchQuery`; [`src/worker/data/nutrition-repository.ts`](../../src/worker/data/nutrition-repository.ts) — `saveRecipeMatches` (`SAVE_GUARD`), `searchFoods`; `PUT /api/recipes/{id}/nutrition`, `GET /api/nutrition/foods` in [`src/worker/index.ts`](../../src/worker/index.ts)                                                                                                                    | [`test/worker/recipe-nutrition.test.ts`](../../test/worker/recipe-nutrition.test.ts) — `food search`, `reading and saving`, `conflicts`, `the request`; [`src/shared/nutrition.test.ts`](../../src/shared/nutrition.test.ts) — `amounts`, `saving matches`, `food search`; [`src/client/RecipeNutrition.test.tsx`](../../src/client/RecipeNutrition.test.tsx) — `checking the matches`; [`src/client/nutrition-client.test.ts`](../../src/client/nutrition-client.test.ts); [`tests/e2e/nutrition.spec.ts`](../../tests/e2e/nutrition.spec.ts) — “a member works out a recipe’s nutrition and checks a changed line”                                                                                                                                                                                                                                                                  | Pending                                      |
| `AC-05`   | [`src/shared/nutrition.ts`](../../src/shared/nutrition.ts) — `buildRecipeNutrition`, `calculateTotals`, `perServing`, `fdcFoodUrl`, `USDA_CITATION`; [`src/worker/data/nutrition-repository.ts`](../../src/worker/data/nutrition-repository.ts) — `readRecipeNutrition`; `GET /api/recipes/{id}` and `GET /api/recipes/{id}/nutrition`; [`src/client/RecipeNutrition.tsx`](../../src/client/RecipeNutrition.tsx) — `RecipeNutritionSection`, `NutritionTable`, `MissingValues`, `Sources`, `ChangedNotice`; [`src/client/nutrition-client.ts`](../../src/client/nutrition-client.ts) — `formatNutrient`                                                                                                                                                            | [`src/shared/nutrition.test.ts`](../../src/shared/nutrition.test.ts) — `calculation`, `a recipe’s nutrition`; [`test/worker/recipe-nutrition.test.ts`](../../test/worker/recipe-nutrition.test.ts) — “converts amounts with USDA portions and calculates the panel”, “names the counted foods that report no value for a nutrient”, `staleness`; [`src/client/RecipeNutrition.test.tsx`](../../src/client/RecipeNutrition.test.tsx) — “shows the label panel per serving and for the whole recipe”, “says which lines changed and checks only those”; [`tests/e2e/visual.spec.ts`](../../tests/e2e/visual.spec.ts) — “recipe detail”, “recipe nutrition review”, and the recipe contrast and stylesheet checks                                                                                                                                                                        | Pending                                      |
| `AC-06`   | [`src/worker/ai/runner.ts`](../../src/worker/ai/runner.ts) — provider failure returns no proposal; [`src/client/NutritionReview.tsx`](../../src/client/NutritionReview.tsx) — unavailable notice, manual search, and Try again; [`src/client/nutrition-client.ts`](../../src/client/nutrition-client.ts) — 70-second request limit                                                                                                                                                                                                                                                                                                                                                                                                                                 | [`test/worker/ai-proposals.test.ts`](../../test/worker/ai-proposals.test.ts) — fallback cases and no configured fallback; [`src/client/RecipeNutrition.test.tsx`](../../src/client/RecipeNutrition.test.tsx) — “shows the unavailable path and retries without saving”; [`tests/e2e/visual.spec.ts`](../../tests/e2e/visual.spec.ts) — “recipe nutrition AI unavailable”                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pending V-DEV-B and V-PROD                   |
| `AC-07`   | [`src/worker/index.ts`](../../src/worker/index.ts) — membership before recipe read and provider call, household-scoped recipe lookup; [`src/worker/ai/nutrition-proposals.ts`](../../src/worker/ai/nutrition-proposals.ts) — minimized payloads and candidate checks; [`src/worker/ai/runner.ts`](../../src/worker/ai/runner.ts) — content-free logs; [`docs/SECURITY.md`](../SECURITY.md)                                                                                                                                                                                                                                                                                                                                                                         | [`test/worker/recipe-nutrition.test.ts`](../../test/worker/recipe-nutrition.test.ts) — “refuses a revoked member and foreign recipe before any provider call”, “discards a food ID outside the candidates and a nutrient value”, `authorization and isolation`; [`test/worker/ai-proposals.test.ts`](../../test/worker/ai-proposals.test.ts) — “sends only the title, requested lines, USDA names and portions”                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Pending V-DEV-B and V-PROD                   |
| `AC-08`   | Migration `0006` cascades; `SAVE_GUARD` stale-row delete; [`src/operations/household-decommission/sql.ts`](../../src/operations/household-decommission/sql.ts) — counts, `COUNT_FIELDS`, `acceptableDeletionChanges`, `EXPECTED_TABLES`; [`procedure.ts`](../../src/operations/household-decommission/procedure.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                | [`test/worker/recipe-nutrition.test.ts`](../../test/worker/recipe-nutrition.test.ts) — “deletes the matches with their recipe”, “deletes a recipe’s stale matches on the next save”; [`test/worker/migration.test.ts`](../../test/worker/migration.test.ts) — “cascades matches from both the recipe and the household”, the schema's column list; [`test/worker/household-decommission.test.ts`](../../test/worker/household-decommission.test.ts) — “counts ingredient matches deleted with their recipe” and the measured `[1, 15]` and `[1, 21]`; [`test/operations/decommission-procedure.test.ts`](../../test/operations/decommission-procedure.test.ts)                                                                                                                                                                                                                        | Pending                                      |
| `AC-09`   | The tests above; local `APP_ENV` selects only the deterministic fake, and [`test/worker/setup.ts`](../../test/worker/setup.ts) blocks remote fetches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [`src/shared/nutrition.test.ts`](../../src/shared/nutrition.test.ts) — calculation and units; [`test/worker/ai-proposals.test.ts`](../../test/worker/ai-proposals.test.ts) — validation and fallback; [`test/worker/recipe-nutrition.test.ts`](../../test/worker/recipe-nutrition.test.ts) — authorization, fake proposals, and save; [`src/client/RecipeNutrition.test.tsx`](../../src/client/RecipeNutrition.test.tsx) — review and unavailable states; [`tests/e2e/nutrition.spec.ts`](../../tests/e2e/nutrition.spec.ts) — phone journey; [`tests/e2e/visual.spec.ts`](../../tests/e2e/visual.spec.ts) — proposed and unavailable baselines                                                                                                                                                                                                                                       | Pending CI Verify, V-DEV-B, and V-PROD       |

## Rollout and rollback

1. **Owner setup, before the development deploy** (all in a browser):
   create one AI Gateway per environment (for example
   `meal-planner-development` and `meal-planner-production`) with
   authentication on and logging set per
   [decision 7](#resolved-design-decisions); create an API token for each
   gateway; create a Gemini API key per environment in Google AI Studio, in a
   project without billing; and add `AI_GATEWAY_TOKEN` and `GEMINI_API_KEY` as
   secrets of each Worker. The implementation PR gives exact steps. Without
   the Gemini secrets, the feature runs with Workers AI only.
2. **Development:** merge, then Deploy development. It runs the gate,
   applies `0006`, loads the reference data, and publishes. Then the owner
   validates on a phone (`V-DEV-…`), including a Workers AI answer, a forced
   Gemini fallback (Workers AI disabled by a variable), the unavailable path,
   and the CPU and neuron figures.
3. **Production:** the owner's approval comment on #84, then Deploy with
   `production_confirmation=DEPLOY_PRODUCTION` (`V-PROD-…`).
4. **Rollback:** redeploy the previous Worker (production is currently
   `6187d831-214f-449c-bd69-df3942027966`). The new tables and column stay,
   unread. To stop AI calls without a rollback, set the Workers AI model
   variable to `off` and `GEMINI_FALLBACK` to `off`: proposals then answer
   unavailable and manual matching still works.

## Resolved design decisions

The design left these nine open, each with a recommendation. The owner chose
the recommended option for every one on 2026-09-26
([record](https://github.com/wpliao/meal-planner/pull/85#issuecomment-5843856770)).

1. **Loading the reference data.** _Chosen:_ a build script downloads
   the pinned USDA releases, checks their SHA-256, filters them, and writes a
   compact, reviewable dataset file committed to the repository. A load step
   in the Deploy workflow runs after migrations and loads it only when
   `nutrition_dataset` names a different version. Tests load a small fixture
   through the same loader. Rejected: the data inside a migration, which
   every Workers-runtime and Playwright run would apply (several megabytes,
   thousands of statements); downloading from USDA during deploy, which ties
   a deploy to USDA's availability; a JSON file in R2, which can't be
   searched by index.
2. **Which foods.** _Chosen:_ Foundation Foods and SR Legacy, leaving
   out the categories a home recipe doesn't use: baby foods, fast foods,
   restaurant foods, and prepared meals, entrées, and side dishes. That is
   about 7,000 foods. Rejected: every Foundation and SR Legacy food (about
   8,200), which adds near-duplicates that make the AI's choice harder.
3. **AI steps.** _Chosen:_ two calls per request (normalize, search,
   choose), so that NZ names such as capsicum, courgette, and mince find
   USDA's names. Rejected: one call after a word search on the line alone,
   which misses those names; a hand-kept NZ-to-US synonym list.
4. **How grams are decided.** _Chosen:_ AI picks a quantity and a unit,
   and the Worker converts it to grams with USDA's portion weights, so the
   review can show "2 tbsp = 36 g" and every gram is traceable. Rejected: AI
   returns grams directly, which puts arithmetic in the model and hides where
   a weight came from.
5. **A food with no value for a nutrient** (some SR Legacy foods report no
   sugars or fibre). _Chosen:_ the total counts the foods that have a
   value, is shown with a marker, and a note names what is missing: "Sugars:
   no value for 2 foods (rice noodles, tamarind)". Rejected: count the gap as
   zero without saying so, which understates; hide the nutrient's row
   entirely, which hides what is known.
6. **Servings on imported recipes.** _Chosen:_ the import preview fills
   **Servings** from the page's `recipeYield` when it begins with a whole
   number from 1 to 50, and the member can change it before saving. Rejected:
   always blank, so every imported recipe needs an extra edit.
7. **AI Gateway's own request logs** hold prompts and answers, and so
   recipe lines. _Chosen:_ turn logging off in both gateways and keep
   only analytics (counts, tokens, errors). Rejected: keep logs, with the
   shortest retention, for debugging proposals.
8. **Models.** _Chosen:_ Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
   which supports [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/),
   and the newest Gemini Flash-Lite model on the free tier, whose free
   request quota is the largest. Pin both names in configuration, and record
   them in the decision log at implementation. Rejected: Workers AI
   `@cf/meta/llama-3.1-8b-instruct`, which uses fewer neurons but chooses
   worse; Gemini Flash, which chooses better but has a much smaller free
   quota.
9. **Delivery.** _Chosen:_ two pull requests, one after the other, each
   with the full gate and review. The first holds servings, the reference
   data and its load, the matches, manual matching, and the panel. It is
   usable without AI, and development can check the data load early. The
   second holds the AI boundary and proposals. Each branch starts from `main`
   after the previous PR is merged, so nothing is stacked or rebased.
   Rejected: one pull request of several thousand lines plus the dataset,
   which is harder to review.

The owner chose these on 2026-09-26, before the design
([record](https://github.com/wpliao/meal-planner/issues/84#issuecomment-5843101922)).

- **N1 — Next feature:** Phase 6 structured nutrition. Avoided ingredients and
  a shopping list are deferred as lower priority.
- **N2 — Data source:** USDA FoodData Central, bundled. The owner asked for a
  metric database. All candidates report values per 100 g, and USDA gives
  gram weights for its household measures, so the app shows g, ml, and kJ
  throughout. Rejected: the Australian Food Composition Database
  (CC BY-SA 3.0 AU with a required notice, about 1,600 foods); NZ FOODfiles,
  whose [terms](https://www.foodcomposition.co.nz/terms/) forbid modifying
  the data, so a subset would need written permission; the USDA live API
  (key, rate limits, runtime dependency).
- **N3 — Nutrients:** the NZ/AU label panel: energy (kJ, with kcal), protein,
  fat, saturated fat, carbohydrate, sugars, dietary fibre, sodium.
- **N4 — First slice:** the recipe page, per serving, with a new servings
  count. Plan totals come in the next feature.
- **N5 — Mapping:** AI proposes each line's food and amount. Rejected:
  a deterministic parser with member confirmation; entry by hand.
- **N6 — Providers:** Workers AI first, the Gemini API's free tier as
  fallback, both through AI Gateway.
- **N7 — Data sent to Gemini:** the recipe title and ingredient lines.
- **N8 — Ages:** the owner stated that every household member is an adult,
  so any member may use either provider.
- **N9 — Review:** nothing counts until a member reviews and saves.
- **N10 — Trigger:** matching runs only when a member taps **Work out
  nutrition** or **Check changed lines**, never on save or import.

## Decision and change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Reason                                                                                                          | Evidence                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-26 | Initial design proposal; status `Designing`; ten decisions resolved by the owner before the design, and nine open. ADRs 0009 and 0010 proposed. Authored by Claude Code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | First Phase 6 feature. The owner chose N1–N10 on 2026-09-26                                                     | [Issue #84](https://github.com/wpliao/meal-planner/issues/84); [owner decisions](https://github.com/wpliao/meal-planner/issues/84#issuecomment-5843101922); [#85](https://github.com/wpliao/meal-planner/pull/85) |
| 2026-09-26 | Resolve the nine open decisions with the recommended options: a committed dataset loaded by a versioned Deploy step; about 7,000 foods without baby, fast, restaurant, and prepared-meal categories; two AI calls per request; AI picks a quantity and unit and the Worker converts with USDA portion weights; missing nutrient values marked and named; imported servings from `recipeYield`; AI Gateway logs off; Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and the newest free Gemini Flash-Lite; two sequential implementation PRs. No acceptance criterion changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | The owner's answers in a Claude Code session, recorded on the design PR                                         | [Owner decisions](https://github.com/wpliao/meal-planner/pull/85#issuecomment-5843856770)                                                                                                                         |
| 2026-09-26 | Accept design; status `Accepted`; `AC-01`–`AC-09` stable; ADRs 0009 and 0010 `Accepted`. Recorded in the design PR, before it merged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Product owner: "I accept the design"                                                                            | [Approval](https://github.com/wpliao/meal-planner/pull/85#issuecomment-5843856770)                                                                                                                                |
| 2026-09-26 | Begin implementation (status `Implementing`) with part A of decision 9, in [#88](https://github.com/wpliao/meal-planner/pull/88): servings, the dataset and its load, migration `0006` with the decommission inventory, matching by search, and the panel. AI proposals are part B. Implementation choices within the design: (1) the dataset is `usda-fdc_2018-04_2026-04-30_r1`: 7,319 foods (6,946 SR Legacy, 373 Foundation) and 12,968 portions, 1.6 MB; the 91 Foundation foods for which USDA reports no energy are left out; (2) a food's density comes from its first plain volume portion (`tbsp`, `cup`, `fl oz`), else its first volume portion, so heavy cream uses its tablespoon, not “cup, whipped”; NZ metric measures (250 ml cup, 15 ml tablespoon, 5 ml teaspoon) convert through it; (3) the load runs `wrangler d1 execute --file --yes`, then the FTS5 rebuild, then the version row, then FTS5's integrity check and the counts, and skips a database that already holds the file's SHA-256; local development loads the full dataset, and the E2E servers and Workers-runtime tests load a 28-food fixture of real USDA rows through the same statements; (4) search uses FTS5 with the porter tokenizer, the query's words as quoted prefixes, ranked by bm25, then shorter name; (5) `GET /api/recipes/{id}` also returns `nutrition`, as it returns #78's preferences, so the page makes no extra request; `GET /api/recipes/{id}/nutrition` refreshes the review after a `409`; (6) a counted line's match carries its food and portions, so the review can change the amount without a request; (7) a save is one `INSERT … SELECT` guarded by the recipe version and every submitted line's current text, so it writes all its lines or none, and the same batch deletes the recipe's stale matches; removing each guard (household, version, line text, household on read, stale delete) fails at least one test; D1 counts a match once when a household delete cascades to it through both parents, measured in the Workers runtime; (8) USDA's slightly negative carbohydrate “by difference” is kept as reported, and a total below zero shows as 0; (9) ADR 0009's sugar row named the nutrients wrongly: nutrient 269 is “Sugars, Total” (“Total Sugars” in Foundation Foods) and 269.3 is “Sugars, Total NLEA”; the build verifies both; (10) the recipe spec's setup helper now waits for either first-run setup or the library, a race the new spec exposed, and the time-zone test's wait for the week gets the same first-render budget as its heading: #87 covered only the heading, and in this PR's full gate the week's data missed 5 s on WebKit under load. Two changes to the design's text, no criterion changed: **Save matches** stays enabled, because the repository's contrast check fails a disabled button (1.75:1) and a disabled button can't be focused to learn why, so pressing it with lines left says how many and focuses the first; and **Check changed lines** lists only those lines, with a sentence about the others, instead of a collapsed “Already checked” list. Reversible UI defaults awaiting owner review: the changed notice is a light clay alert; an incomplete total is marked “†” with a note naming the foods; **Sources (N)** is a collapsed disclosure whose links say “(opens in a new tab)”; “Serves 4” shows under the provenance and in the per-serving column heading; the review is full screen up to 36em wide; search results are a list of buttons under the field, after a 300 ms pause, each with its USDA category; units list g and kg, then the metric volumes when the food has a density, then each USDA portion as “large (50 g each)”; a line starts at grams with an empty amount; “= 36.5 g” shows beside the unit; **Servings** follows the title, with an input 8rem wide | Implementation of the accepted design; each default is the smallest choice consistent with the existing screens | [#88](https://github.com/wpliao/meal-planner/pull/88)                                                                                                                                                             |
| 2026-09-26 | Fix the Deploy load step: the first development deploy (run 36237381730) applied migration `0006`, then stopped at the load, before publishing the Worker, because a remote `wrangler d1 execute --file` prints progress lines to standard output even with `--json`. A file import is now judged by its exit status, and command output is parsed from its first JSON line (`wranglerRows`). The version row had not been written, so the next deploy reloads from scratch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Found by the first remote run; local runs print no progress                                                     | [Deploy run 36237381730](https://github.com/wpliao/meal-planner/actions/runs/36237381730); [#89](https://github.com/wpliao/meal-planner/pull/89)                                                                  |
| 2026-09-26 | Implement part B: two structured calls per request (normalize, then choose), with candidate search from the phrase and original words; Workers AI first, then Gemini after quota, error, timeout, or malformed output; a deterministic local fake; each result is still a proposal until confirmed. Pin `gemini-3.5-flash-lite`, the latest free-tier text Flash-Lite shown in Google pricing at implementation. A `0` candidate ID means “not counted” in the model schema; foreign IDs and unusable amounts are discarded. Gemini’s account ID joins its optional Worker secrets because the gateway URL requires it. Reversible UI default: retry keeps any manual edits already made in the review and fills only returned matches. No accepted criterion changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ADR 0010 and the accepted design; no new provider or data field                                                 | This implementation PR; [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)                                                                                                                           |

## Release record

- Development validation: Pending
- Production release: Pending
- Known follow-up work: daily and weekly nutrition totals on the meal plan.
