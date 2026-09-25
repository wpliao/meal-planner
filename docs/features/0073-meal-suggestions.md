# Feature: Suggest recipes for a meal from the pantry and recent plans

- Status: Accepted
- Phase: 5 — deterministic suggestions
- Issue: [#73](https://github.com/wpliao/meal-planner/issues/73)
- Product owner: Repository owner
- Last updated: 2026-09-25
- Pull requests: [#74 — design proposal](https://github.com/wpliao/meal-planner/pull/74); [#PR1 — design acceptance record](https://github.com/wpliao/meal-planner/pull/PR1)

## Problem and outcome

When a member adds a meal to the plan, the **Pick a recipe** field offers the
whole library, sorted by title. Nothing helps answer "what should we have?".
The app already knows what is at home (the pantry,
[#16](./0016-lightweight-pantry.md)), which recipes the family keeps
([#31](./0031-recipe-library.md)), and what was planned recently
([#49](./0049-meal-planning.md)). Today the member cross-checks those three by
hand.

The outcome: while picking a recipe for a meal, the member sees up to five
suggested recipes, each with plain reasons such as "Uses what you have:
chicken, rice (low), garlic" or "Last planned on Monday 3 August". The ranking
is deterministic: the same data always gives the same suggestions. No AI or
external service is involved, and the member still chooses. Nothing is
planned automatically.

This is the first Phase 5 feature in [PRODUCT.md](../PRODUCT.md#planned-product-phases).
It uses the pantry and plan history only; stored household preferences are a
later Phase 5 feature with their own retention design.

The product owner settled seven choices on 2026-09-25, before this design was
written, and [answered](https://github.com/wpliao/meal-planner/pull/74#issuecomment-5827466243) the three decisions the design left open, each
with the recommended option. All ten are recorded under
[Resolved design decisions](#resolved-design-decisions). The owner
[accepted the design](https://github.com/wpliao/meal-planner/pull/74#issuecomment-5827643026)
on 2026-09-25; acceptance authorizes implementation only, not deploying
or changing production, which keep their existing approval gates.

## User scenarios

1. Given an active member adding Thursday dinner, when they open **Add** and
   stay on **Pick a recipe**, then up to five suggested recipes appear above
   the search field, each with its reasons. Choosing one selects it exactly as
   searching for it would, and **Add to plan** plans it.
2. Given rice marked **needed** in the pantry, when a recipe mentions rice,
   then rice does not count as something the household has, and the reasons
   say "Needs: rice".
3. Given curry planned on Monday, when a member adds Wednesday's dinner, then
   curry ranks below recipes with as many pantry matches that were not planned
   within 14 days, and its reason says "Also planned on Monday 21 September".
4. Given a household with no pantry items or no plan history, when a member
   opens **Add**, then suggestions still appear in a documented order, and no
   reason claims something the data does not show.
5. Given a revoked member, a non-member, or a request without a valid Access
   assertion, when suggestions are requested, then nothing is returned and no
   household data is disclosed.

## Scope

- Included: a read-only Worker route that ranks the household's recipes for a
  plan date; a pure, documented matching and ranking function; a "Suggested"
  group in the add dialog's **Pick a recipe** mode; reasons built from pantry
  matches and plan dates; loading, empty, and failure states.
- Not included: stored preferences (likes, dislikes, dietary exclusions) and
  "Not now" feedback; generative or AI suggestions (Phase 7); nutrition-based
  ranking (Phase 6); suggesting recipes outside the library; filling a day or
  week automatically; changing the pantry when a meal is planned or cooked;
  linking ingredient lines to pantry items by hand, synonyms, or fuzzy
  matching; using the meal (breakfast, lunch, or dinner) in the ranking; and
  suggestions in **Add to plan** on a recipe's page, which already has its
  recipe.

## Acceptance criteria

These stable identifiers mirror [issue #73](https://github.com/wpliao/meal-planner/issues/73).

- [ ] `AC-01`: When an active member picks a recipe for a meal, the dialog
      shows up to 5 suggested recipes before the full list. Choosing one plans
      it exactly as picking it from the list does. Non-members and revoked
      members receive no suggestions.
- [ ] `AC-02`: Each suggestion shows at least one human-readable reason taken
      from household data: pantry items its ingredients mention, and when the
      recipe was last or next planned. No reason is shown that the data does
      not support.
- [ ] `AC-03`: The ranking is deterministic and documented: the same pantry,
      recipes, plan, and meal date always give the same order, with a stable
      tie-break.
- [ ] `AC-04`: Suggestions use only the member's own household's data. They
      never reveal another household's data, and they call no AI, external
      API, or paid service.
- [ ] `AC-05`: The empty and sparse cases are handled: no recipes, no pantry
      items, no plan history, or nothing matching.
- [ ] `AC-06`: Unit tests cover the ranking, Worker-runtime tests cover
      authorization and household isolation, and Playwright covers picking a
      suggestion on a phone viewport.

## Experience design

The design adds to the #49 add dialog (`AddEntryDialog`) and changes nothing
else in the plan.

**Where.** In **Pick a recipe** mode, a group titled "Suggested for Thursday
dinner" sits above the **Recipe** search field. It is a radio group of up to
five recipes. Each option shows the recipe title, with its reasons on one or
two short lines below. Choosing an option selects that recipe: the **Recipe**
field shows it, and **Add to plan** plans it with any note, exactly as a
searched recipe is planned ([decision 3](#resolved-design-decisions)).
Choosing a different recipe in the search field clears the radio choice unless
that recipe is also a suggestion. **Type a meal** mode shows no suggestions.

**Reasons.** Each suggestion shows these, in this order, when they apply:

- **Pantry held:** "Uses what you have: chicken, rice (low), garlic". Items
  with status `available` or `low` whose names its ingredient lines mention,
  in pantry-name order, with `low` marked. At most four names, then "and 2
  more".
- **Pantry needed:** "Needs: soy sauce". Items with status `needed` that its
  ingredient lines mention, formatted the same way.
- **Planning,** always exactly one of:
  - "Already planned for this day" when it is planned on the meal's date;
  - "Also planned on Friday 2 October" when it is planned within 14 days of
    the meal's date, naming the nearest such date (the earlier one on a tie);
  - "Last planned on Monday 3 August" when its latest planned date before the
    meal's date is older than 14 days (the year is added when it differs from
    the meal's year);
  - "Not planned before" otherwise.

Every suggestion has the planning reason, so none is shown without a reason
(`AC-02`). Only recipe entries still linked to the recipe count as planning it.
A typed meal named "Curry" is not the recipe, and an entry whose recipe was
deleted is not linked to any recipe.

**States.**

- Loading: "Finding suggestions…" in a polite `output`, while the recipe list
  loads separately. Neither waits for the other.
- An empty library: no suggestion group. The picker's existing "The recipe
  library is empty" message stands alone.
- Fewer than five recipes: all of them, ranked.
- Nothing in the pantry or no plan history: suggestions still appear, ordered
  by the rules below. Their reasons are the planning reason alone, such as
  "Not planned before".
- Failure: "Suggestions are not available right now." with **Retry**. The
  **Recipe** search field keeps working, so a failed suggestion request never
  stops a member from adding a meal.
- A suggested recipe deleted meanwhile: **Add to plan** fails as it does today
  for a deleted recipe, and the dialog reloads the recipe list and the
  suggestions.

On a phone, the group adds up to about 330px above the search field, and the
modal scrolls as it does today. Each option is a full-width touch target of at
least 44px.

## Ranking (`AC-03`)

All matching and ranking is one pure function, so it can be tested
exhaustively and gives the same answer in every runtime.

**Normalising text.** Pantry names and ingredient lines are compared in
Unicode NFKC form, lower-cased, as `normalizePantryName` already does for
duplicate detection. Ingredient lines are never changed; only the comparison
copy is normalised.

**Matching a pantry item to a recipe** (resolved decision R3, with
[decision 2](#resolved-design-decisions) for scripts without spaces):

- A pantry name is split into words: runs of letters and digits
  (`\p{L}` and `\p{N}`). Everything else, such as spaces, commas, hyphens,
  and brackets, separates words.
- The name matches an ingredient line when the line contains the same words,
  consecutive and in order, as whole words. The name's last word may also
  appear with `s` or `es` added, or, if it ends in `s`, without it. So "egg"
  matches "2 eggs, beaten", "tomato" matches "tomatoes", "eggs" matches "1
  egg", and "olive oil" matches "2 tbsp olive oil". "egg" does not match
  "eggplant", and "oil" does match "olive oil".
- A name containing Chinese, Japanese, or Korean characters matches wherever
  its normalised text appears inside a line, because those scripts do not put
  spaces between words ([decision 2](#resolved-design-decisions)).
- A recipe mentions a pantry item if any of its ingredient lines matches the
  item. Steps, notes, and titles are not searched.

Known misses, accepted in R3 and visible in the reasons: synonyms (scallion
and spring onion), irregular plurals (leaf and leaves), and words the family
spells differently in the pantry and the recipe.

**Order.** Recipes are sorted by these keys, each breaking ties in the one
before:

1. **Pantry held**, the number of distinct `available` or `low` pantry items
   the recipe mentions: more first. `needed` items do not count and do not
   subtract.
2. **Recently planned**, meaning planned on any date from 14 days before to 14 days
   after the meal's date: recipes that are not recently planned come first.
3. **Last planned**, the latest planned date before the meal's date: never
   planned first, then the oldest date first.
4. **Title**, compared by Unicode code points after normalising as above, and
   then **recipe ID**. Code-point order is used instead of locale collation
   so the Worker and tests cannot disagree.

The first five are suggested. Because the pantry comes first (R5), a recipe
planned yesterday that uses three held items ranks above a recipe never
planned that uses two. The planning reason says so.

The 14-day window and the limit of five are named constants in the shared
contract, `MEAL_SUGGESTION_RECENT_DAYS` and `MEAL_SUGGESTION_LIMIT`.

## Technical design

### Boundaries and contracts

The Worker reuses the verified identity and active-membership boundary from
[ADR 0004](../DECISIONS/0004-access-identity-and-household-authorization.md).
Household scope comes from `MemberContext`, never from the URL.

New route:

- `GET /api/meal-plan/suggestions?date=YYYY-MM-DD`
  - `200` with `{ suggestions: MealSuggestion[] }`, at most 5, in ranked
    order. An empty array for an empty library.
  - `400 invalid_request` for a missing, malformed, or unknown query
    parameter, or a date outside the write window. The window is the one used
    for adding (8 weeks back to 52 weeks ahead, with the Worker's one-day
    slack), since a suggestion is only useful for a date that can be planned.
  - The existing `401`/`403` answers for an unverified identity, a
    non-member, or a revoked member, before any household statement runs.

Shared contract in a new `src/shared/meal-suggestions.ts`:

```ts
interface MealSuggestion {
  recipeId: string;
  title: string;
  pantry: {
    held: { name: string; status: 'available' | 'low' }[];
    needed: string[];
  };
  // The nearest planned date within the recent window, or null.
  recent: string | null;
  // The latest planned date before the meal's date, or null.
  lastPlanned: string | null;
}
```

- `MEAL_SUGGESTION_LIMIT` (5) and `MEAL_SUGGESTION_RECENT_DAYS` (14).
- `pantryMentions(lines, pantry)` and `rankMealSuggestions(input)`, the pure
  matching and ranking functions described in [Ranking](#ranking-ac-03).
- `validateSuggestionQuery(params, now)`.

The response carries structured reasons, not sentences. The client words them,
so the wording can change without an API change. The client adds the
suggestion group to `AddEntryDialog` in `src/client/MealPlanDialogs.tsx` and a
`fetchSuggestions` call. No new external request is made.

### Data and migrations

**No migration and no new table.** The route reads three existing tables in
one D1 batch, so the pantry, recipes, and plan are read from one consistent
state:

1. the household's pantry items (at most 500 rows);
2. every ingredient line of the household's recipes, joined through
   `recipes.household_id` (at most 500 × 100 rows);
3. the household's recipe entries aggregated per recipe in SQL: the latest
   date before the meal's date, and the entries within 14 days of it. That is
   at most one row per recipe plus the window's entries, over at most 4,000
   entries through the `(household_id, plan_date)` index.

Titles come from the same recipe rows. Because nothing is written, the
household decommission inventory in `src/operations/household-decommission/`
is unchanged, as are retention and deletion. Suggestions are computed per
request and never stored.

### Cost on Workers Free

The account is on Workers Free
([#32](./0032-household-lifecycle.md)): 10 ms of CPU per request, and 5
million D1 rows read per day. Matching is the only real work, and it grows
with the library's ingredient text. A prototype of the matcher above (not
committed) was measured in the Dev Container on 2026-09-25. It indexes pantry
names by first word, then makes one pass over each line's words:

| Library                                       | Ingredient text | Median in the Dev Container |
| --------------------------------------------- | --------------- | --------------------------- |
| 100 recipes × 12 lines × 35 chars, 80 pantry  | 0.04M chars     | 2.7 ms                      |
| 500 recipes × 20 lines × 50 chars, 300 pantry | 0.5M chars      | 22 ms                       |
| 500 × 100 × 300 (the maximum), 500 pantry     | 15M chars       | 583 ms                      |

The Dev Container is slow: it ran 10⁸ JavaScript additions in about 1 s,
roughly ten times a typical server. So edge CPU is likely about a tenth of
these figures, within budget for the first two rows and far over it at the
maximum. D1 rows read follow the same shape: about 1,300 per request for the
first row, 10,300 for the second, and 50,500 at the maximum, plus the plan
entries read (at most 4,000). At the maximum, that is about 90 requests a day
against the 5 million budget, which the household shares with every other
request.

A library near the maximum is unlikely: it means 500 recipes, each with 100
ingredient lines of 300 characters. By
[decision 1](#resolved-design-decisions), suggestions are computed per request
and fail on their own if a library ever outgrows the budget.

### Security and privacy

- Every statement is scoped to the verified member's household. Ingredient
  lines are reached only through `recipes.household_id`, and plan entries only
  through `meal_plan_entries.household_id`. A recipe ID from another household
  can never appear.
- The route is read-only. It accepts one query parameter, which is
  validated, and rejects unknown parameters. It has no request body.
- The response holds only the caller's own recipe titles, pantry names, and
  plan dates: data the member can already read through the recipe, pantry,
  and plan routes. It grants no new access.
- No pantry name, ingredient text, recipe title, date, or member identity
  appears in application logs or error messages.
- Nothing is sent to a third party. There is no AI, external API, new secret,
  or new binding (`AC-04`).
- Ingredient text is compared, never interpreted: no `eval`, no dynamic
  regular expressions built from household text, and no HTML. Matching uses a
  fixed word pattern and exact word comparison, so a pantry name cannot
  inject a pattern.

### Accessibility

The suggestions are a native radio group, labelled by its heading "Suggested
for Thursday dinner". Each radio's accessible name is the recipe title, and
its reasons are its description (`aria-describedby`), so a screen reader
announces the title and then why. Arrow keys move within the group, and Tab
moves on to the **Recipe** field. Loading and failure text is a polite
`output`, as the picker's is. Focus handling in the dialog is unchanged.
Contrast and visual snapshots are checked on Chromium and WebKit at desktop
and phone sizes.

### Reliability and observability

The route is read-only and safe to retry. It fails independently of the
recipe list, and the dialog degrades to today's picker. A request that fails,
including one stopped by the CPU limit, shows the failure state with
**Retry**. Development validation checks the CPU time of real suggestion
requests in Workers observability, with no household content logged.

## Test strategy

- Shared unit tests (`src/shared/meal-suggestions.test.ts`):
  - matching: whole words; `s`, `es`, and dropped-`s` forms; multi-word
    names; punctuation and brackets as separators; "egg" not matching
    "eggplant"; NFKC and case; CJK names as substrings; empty names and lines
  - ranking: each key in turn, with its tie-breaks; the 14-day boundary on
    both sides (days 14 and 15); a recipe planned on the meal's date; future
    and past entries; code-point title order; the limit of 5; empty
    inputs
  - reason inputs: held and needed lists in pantry-name order; `recent`
    picks the nearest date, and the earlier date on a tie
  - `validateSuggestionQuery`: missing, malformed, repeated, and unknown
    parameters, and the window edges
- Workers-runtime tests (`test/worker/meal-suggestions.test.ts`):
  - a member gets ranked suggestions from their own pantry, recipes, and plan
  - another household's recipes, pantry items, and entries never affect or
    appear in the result
  - revoked members, non-members, and requests without a valid Access
    assertion are refused before any household statement
  - an empty library, an empty pantry, and no plan history
  - text entries and entries of deleted recipes do not count as planning
  - dates outside the write window are refused
  - no pantry name, ingredient text, or title in the console
- Client unit tests (`src/client/MealPlan.test.tsx`): the group appears in
  **Pick a recipe** mode only; reasons are worded as specified, including "and
  2 more", "(low)", and each planning reason; choosing a suggestion selects the
  recipe and **Add to plan** sends the same request as a searched recipe; the
  loading, empty-library, and failure states, with **Retry**; the picker still
  works when suggestions fail.
- Playwright (`tests/e2e/meal-plan.spec.ts`) on Chromium and WebKit, desktop
  and phone: seed pantry items and recipes through the API, open **Add**, see
  the expected first suggestion and its reason, and plan it; a keyboard-only
  pass; visual snapshots of the group, each reviewed before commit.
- Development validation on a real phone with the family's real data,
  recording the suggestion requests' CPU time.

## Traceability

Implementation is expected in one pull request: the shared contract and
ranking, the Worker route, the dialog, and the tests, with no migration.

| Criterion | Implementation | Automated tests | Release evidence |
| --------- | -------------- | --------------- | ---------------- |
| `AC-01`   | Pending        | Pending         | Pending          |
| `AC-02`   | Pending        | Pending         | Pending          |
| `AC-03`   | Pending        | Pending         | Pending          |
| `AC-04`   | Pending        | Pending         | Pending          |
| `AC-05`   | Pending        | Pending         | Pending          |
| `AC-06`   | Pending        | Pending         | Pending          |

## Rollout and rollback

1. The owner answered the three open decisions and accepted the design on
   2026-09-25. The status became `Accepted` on `main` before any feature code
   was written.
2. Implement on a focused `claude/` branch. Run the full Dev Container gate,
   and require CI, Sonar, and a security review. There is no migration.
3. Merge to `main`, then deploy development. Validate on a phone
   (`V-DEV-S1`): with a few pantry items and recipes, open **Add**, check that
   the suggestions and reasons match the data, and plan one. Mark an item
   **needed** and check that the reason changes. Record the CPU time of the
   suggestion requests from Workers observability.
4. Get the owner's separate, explicit production approval on issue #73 before
   the production deploy. Record the run, Worker version, and the owner's
   checks (`V-PROD-S1`).

Rollback redeploys the Worker version that was live before the release. There
is no data to restore, because nothing is written.

## Resolved design decisions

The product owner [answered these](https://github.com/wpliao/meal-planner/pull/74#issuecomment-5827466243) on 2026-09-25 on the design PR,
each with the recommended option.

1. **A very large library on Workers Free (10 ms CPU):** **compute per request,
   and let suggestions fail on their own.** A typical and even a large library
   fit the budget (see [Cost on Workers Free](#cost-on-workers-free)). If a
   library ever grows near the maximum, suggestion requests fail and show
   **Retry**, while adding meals keeps working. Development validation
   records real CPU time, and a follow-up would add precomputation if a real
   household approaches the limit. Rejected: precomputing each recipe's
   matchable words on save (a new column, a migration, and a backfill, for a
   case no household has yet); moving the account to Workers Paid (US$5 a
   month).
2. **Pantry names in Chinese, Japanese, or Korean:** **match as a substring.**
   "豆腐" matches "300克豆腐". The cost is false matches inside longer words:
   "蔥" (scallion) also matches "洋蔥" (onion). The reason shows the match, so
   a person can see it. Rejected: whole words only, under which such names
   would almost never match.
3. **Choosing a suggestion:** **it selects the recipe, and Add to plan plans
   it.** This matches `AC-01` ("exactly as picking it from the list does"),
   keeps the optional note, and gives one place to confirm, in two taps.
   Rejected: a one-tap **Add** button on each suggestion, which skips the note
   and is a second way to submit the dialog.

The owner chose these on 2026-09-25, before the design, each with the
recommended option.

- **R1 — Signals:** the pantry and recent plans only. Preferences and "Not
  now" feedback are a later Phase 5 feature, because they need new stored data
  and retention rules
  ([DATA_MODEL.md](../DATA_MODEL.md#durable-principles)).
- **R2 — Placement:** a "Suggested" group of up to 5 in the add dialog's
  **Pick a recipe** mode. Rejected: a Suggest action on each empty meal; a
  separate Suggestions page.
- **R3 — Matching:** whole words, case-insensitive, with simple plurals, and
  every match shown as a reason. Rejected: linking ingredient lines to pantry
  items by hand; fuzzy matching.
- **R4 — Pantry status:** `available` and `low` count as held, and `low` is
  named in the reason. `needed` never counts, and is named as needed.
  Rejected: `available` only.
- **R5 — Order:** pantry matches first, then a 14-day window either side of the
  meal's date (so recipes already planned later that week rank lower too),
  then least recently planned, then title. The meal is not used. Rejected:
  also preferring recipes planned for the same meal before; recency first.
- **R6 — Where it runs:** a read-only Worker route running a pure, unit-tested
  function. Rejected: ranking in the browser, which would download every
  ingredient line each time the dialog opens.
- **R7 — No AI, no external service, no schema change** for this feature.

## Decision and change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                     | Reason                                                                                                                               | Evidence                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-25 | Initial design proposal; status `Designing`; seven decisions resolved by the owner before the design and three open. Authored by Claude Code                                                                                                                                                                                               | First Phase 5 feature. The owner chose the first slice's signals, placement, matching, status rule, order, and runtime on 2026-09-25 | [Issue #73](https://github.com/wpliao/meal-planner/issues/73); [#74](https://github.com/wpliao/meal-planner/pull/74)                        |
| 2026-09-25 | Resolve the three open decisions with the recommended options: compute per request and let suggestions fail on their own; match Chinese, Japanese, and Korean pantry names as substrings; choosing a suggestion selects it and **Add to plan** plans it. No acceptance criterion changes. Status stays `Designing` until the owner accepts | The owner's answers on the design PR                                                                                                 | [Owner comment](https://github.com/wpliao/meal-planner/pull/74#issuecomment-5827466243)                                                     |
| 2026-09-25 | Accept design; status `Accepted`; `AC-01`–`AC-06` stable. Recorded after #74 merged, because #74 merged while the status still read `Designing`                                                                                                                                                                                            | Product owner: "I accept the design"                                                                                                 | [Approval](https://github.com/wpliao/meal-planner/pull/74#issuecomment-5827643026); [#PR1](https://github.com/wpliao/meal-planner/pull/PR1) |

## Release record

- Development validation: Pending
- Production release: Pending
- Known follow-up work: stored household preferences and "Not now" feedback,
  as a separate Phase 5 feature.
