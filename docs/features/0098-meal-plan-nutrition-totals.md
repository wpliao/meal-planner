# Feature: Daily and weekly meal-plan nutrition totals

- Status: Designing
- Phase: 6 — structured nutrition
- Issue: [#98](https://github.com/wpliao/meal-planner/issues/98)
- Product owner: Repository owner
- Last updated: 2026-09-27
- Pull requests: [#99 — draft design proposal](https://github.com/wpliao/meal-planner/pull/99)

## Problem and outcome

The shared [meal plan](./0049-meal-planning.md) shows what the family intends
to eat, and a checked [recipe](./0084-recipe-nutrition.md) shows the existing
NZ/AU nutrition panel. The plan does not show what its recipe entries add up to
over a day or week. A member needs an estimate they can understand and correct
without treating a free-text meal, a missing serving count, or an unchecked
ingredient as zero.

The outcome is a daily and displayed-week summary of the eight existing panel
nutrients. It is calculated from current, confirmed recipe matches and the
pinned USDA data. The summary names its coverage and links to recipes that
need attention. It is a planning estimate, not a record of what anyone ate.

The owner wants the major features available for an app release. This design
keeps the slice on the existing plan and nutrition data: no new provider,
dataset, targets, or tracking workflow. It is **not accepted yet**; the
[portion rule](#open-owner-decision) must be resolved before implementation.

## User scenarios

1. Given a week with checked recipes, when a member opens its plan, then they
   see an estimate for each day and the Monday–Sunday week, with the existing
   eight nutrients and energy in kJ and kcal.
2. Given the same recipe planned twice, when totals are calculated, then
   each entry contributes once under the accepted portion rule. A moved or
   removed entry affects the next read.
3. Given a recipe with an unchecked or changed ingredient, a deliberate
   **Don't count** line, a missing USDA nutrient, or no servings count, when
   the member views the plan, then they see what is included, what is missing,
   and a link to the recipe where the gap can be addressed.
4. Given a free-text meal or a recipe deleted from the library, when the
   member views the plan, then the entry remains visible but contributes no
   invented nutrition.
5. Given a recipe match or servings change, when the plan is refreshed, then
   its estimate reflects the current recipe without a separate save or
   background job.
6. Given a non-member or revoked member, when they request totals, then no
   household nutrition or plan data is returned.

## Scope

- Included: totals for the displayed seven-day plan; a daily summary for all
  three meal slots; a weekly summary; per-nutrient missing-value notices;
  planned-entry coverage; links to live recipes needing attention; responsive
  and accessible loading, empty, and failure states.
- Not included: personal consumption records, household headcount, nutrient
  targets or daily-intake percentages, medical advice, free-text nutrition,
  automatic recipe matching, new AI calls, ranking suggestions by nutrition,
  pantry deduction, new USDA releases, or periods longer than the displayed
  week. The recipe page keeps its existing calculation and review flow.

## Acceptance criteria

These draft identifiers mirror [issue #98](https://github.com/wpliao/meal-planner/issues/98).
They become stable when the owner accepts the design.

- [ ] `AC-01`: The week view displays estimated values for the eight existing
      NZ/AU panel nutrients for each day and the displayed Monday–Sunday
      week, with energy in kJ and kcal, using only saved current recipe
      matches and USDA reference values.
- [ ] `AC-02`: Each planned recipe entry contributes according to the
      accepted portion rule. Repeated entries each contribute once. Free-text
      entries and deleted recipes contribute no numeric value and are
      identified as gaps.
- [ ] `AC-03`: The view distinguishes a complete estimate from partial data:
      unchecked or changed ingredient lines, uncounted lines, recipes without
      servings, and missing nutrient values are represented according to the
      accepted design. A member can navigate to a live recipe to address a
      gap.
- [ ] `AC-04`: Totals reflect current household plan entries, recipe
      servings, ingredient text, confirmed matches, and USDA values on the
      next read. No AI request, nutrient snapshot, or member-entered nutrient
      value is used.
- [ ] `AC-05`: Only active members can read their household's totals. The
      Worker validates date bounds and household scope, and neither logs nor
      discloses family meal data to another household or external provider.
- [ ] `AC-06`: The totals and coverage are readable on a phone and desktop,
      keyboard accessible, and understandable without color alone. Loading,
      empty, and failure states preserve the usable plan.
- [ ] `AC-07`: Deterministic unit tests prove aggregation and incomplete-data
      rules; Workers-runtime tests prove authorization, isolation, staleness,
      and bounded reads; Playwright covers the main phone journey on
      Chromium and WebKit. No test uses a remote AI or nutrition service.

## Experience design

The `/plan/:weekStart` view gains a **Week nutrition estimate** section after
the week navigation and before the day cards. It shows the eight existing
panel rows, including energy in kJ with kcal in parentheses, and the plain
sentence **Based on one serving of each included recipe entry** under the
provisional portion rule. The section says how many of the week's planned
entries contributed. A day card gains a compact **Day nutrition estimate**
line with energy, protein, and coverage; an expandable table shows all eight
rows. The week table remains visible. A member can open a day's details with
keyboard or touch, and neither table uses color alone to convey status.

The language names the denominator: **X of Y planned entries included**.
`Y` includes recipe and free-text entries; `X` counts recipe entries with at
least one current counted ingredient, a servings count, and a per-serving
estimate. Repeated entries count separately. The section lists gaps by day
and entry, using the plan's existing display title and a reason:

- **Add servings** when a live recipe has counted nutrition but no servings;
  it contributes no value under the provisional per-serving rule.
- **Work out nutrition** when no current counted ingredient contributes.
- **Check recipe nutrition** when ingredient lines are unchecked, changed,
  or deliberately not counted. A partial recipe still contributes its known
  values; the notice says which kind of gap exists.
- **Some USDA values are missing** when a counted food has no value for a
  nutrient. The affected nutrient row is marked **Partial**; its known
  amount remains visible. The linked recipe shows the food-level details.
- **No nutrition for text meals** or **Recipe removed** for entries that
  cannot contribute and have no live recipe link.

The sum of known amounts is never labelled complete when any entry or
nutrient has a gap. A nutrient with no known amount shows **—**, not `0`.
An actually known zero can show `0`. Daily and weekly numbers are rounded
only for display, with the same formatting as the recipe panel. A weekly
row is partial if any of its days is partial for that nutrient or has an
excluded entry. All totals carry **Estimate, not dietary advice** and the
USDA citation from the recipe feature, with a link to the source explanation
on a recipe. No daily-intake percentage or personal target appears.

An empty week keeps its plan cards and says **Add a recipe to see a nutrition
estimate**. If the nutrition read fails, the plan stays usable and the
section offers **Try again**. Loading the plan and loading nutrition are
separate states, so a slow calculation does not hide the week. After a plan
mutation, the client refreshes both reads; a member can also refresh the
page after a recipe changes elsewhere. The design does not imply live
updates across devices.

## Technical design

### Boundaries and contracts

Add `GET /api/meal-plan/nutrition?week=YYYY-MM-DD`. `week` must be a valid
Monday date; no duplicate or unknown query parameters are accepted. The
Worker checks the verified Access identity and active D1 membership before
any household read. The week is seven calendar-date strings, using the
existing `src/shared/meal-plan.ts` date arithmetic. It is not interpreted
as UTC timestamps. Invalid input returns `400 invalid_request` without plan
content. A valid empty week returns an empty summary, not `404`.

A new runtime-neutral contract in `src/shared/meal-plan-nutrition.ts` describes
eight nutrient amounts, per-row partial flags, day/week coverage, and gap
reasons. The response contains only the requested week: seven days, their
summaries, and a week summary. Entry-level gaps use plan entry IDs and,
only for this authorized household, the same display title and live recipe
ID as the plan read. The response does not include ingredient text, prompts,
or raw USDA rows.

The Worker repository selects at most one week's 126 plan entries (seven
days × three meals × six entries). It joins live recipes using both recipe
ID and household ID. It calculates each distinct live recipe's nutrition
from current `recipe_ingredients`, confirmed
`recipe_ingredient_matches`, and `nutrition_foods`, with a line contributing
only when its saved text still matches the current line at that position.
An explicit **Don't count** line has no numeric contribution and is reported
as omitted. A match to a removed USDA food contributes nothing and is
reported as needing review. Per-recipe values are calculated once, then
applied once for every plan entry that names that recipe. Aggregation retains
unrounded values until the client formats them.

The implementation should use bounded, household-scoped prepared queries
and avoid one database round trip per entry. It may aggregate per-recipe
values in SQL for Workers Free CPU cost, but a parity test must compare
its numbers and missing-value semantics against the released recipe
nutrition calculation (`calculateTotals`, `perServing`, and staleness in
`buildRecipeNutrition`). The plan-only `GET /api/meal-plan` stays independent,
so a nutrition failure cannot make the plan unusable. A plan or recipe change
between the two reads can briefly yield different snapshots; refreshing
resolves this display-only difference.

### Portion rule and aggregation

**Provisional owner decision:** each plan entry represents one serving of
its linked recipe. A recipe with `servings = 4` contributes one quarter of
its whole-recipe known values for each entry. The daily total sums entries
on that date across breakfast, lunch, and dinner. The week sums the seven
unrounded daily totals. Two entries for the same recipe contribute twice.
The result is an illustrative one-person menu; it does not claim to be a
household total or an intake record. The section and API contract must say
this explicitly. The owner may instead choose whole recipes or editable
portions in the [open decision](#open-owner-decision).

The aggregation preserves `null` separately from known zero. If a recipe
or nutrient has no known value, it adds no number and lowers coverage. A
partially known recipe contributes the known amount and marks the affected
day and week nutrient as partial. An unchecked or changed ingredient, or
one deliberately not counted, makes the affected recipe's estimate partial
for all nutrients because its contribution is unknown. A nutrient missing
from one counted USDA food makes that row partial. The summary never fills
gaps with AI output or a guessed amount.

### Data and migrations

Under the provisional one-serving rule, no schema change is needed. The
endpoint derives its response from the current plan entries, recipes,
ingredient lines, confirmed matches, and global USDA reference tables.
It writes no snapshot, personal consumption record, or audit row. Existing
retention and deletion rules remain: removing a plan entry removes its
contribution on the next read; recipe deletion retains the plan title but
sets its link to `NULL`; household decommission deletes plan entries and
matches. If the owner chooses editable portions, this section must be
revised with a forward migration, bounds, conflict semantics, retention,
and a matching decommission test **before acceptance**.

### Security and privacy

Only the Worker's verified active member context supplies `householdId`.
Every plan, recipe, ingredient-match, and food lookup is scoped through it.
The request contains only a week date; no caller-supplied household or recipe
ID is trusted. Non-members receive the existing authorization response; a
foreign household's entries never appear, including as a gap title or
count. The route is read-only and uses existing same-origin response and
cache controls. No family meal, recipe, ingredient, member identity, or
Access assertion is logged. No data is sent to AI Gateway, Gemini, USDA,
or another third party by this feature.

### Accessibility

The week section has a heading in the page's reading order, each day uses
its existing heading, and a table has row labels and a caption naming the
period. **Partial** and **—** are text, not color. Gap links name the recipe
and action, with no ambiguous repeated **Fix** links. The daily disclosure
uses a native control with a visible focus indicator and touch target of at
least 44 px. Loading and retry text are announced politely without stealing
focus. Phone and desktop checks include keyboard order, VoiceOver or another
screen reader, zoom, and reduced-motion settings where applicable.

### Reliability and observability

The maximum read is exactly seven days and the plan's existing limits bound
the number of entries. The implementation must measure the route in
development using a week near the 126-entry bound, including repeated and
distinct recipes, before release; if Workers Free CPU or response time is
too high, reduce query work before production. The Worker emits only
content-free route outcome, elapsed time, and counts if additional
instrumentation is needed. It does not cache or persist totals, so recipe
edits and plan changes do not require invalidation or a backfill. A failed
nutrition read is independently retryable and does not change plan data.

## Test strategy

- Shared unit tests for one-serving division, repeated entries, day/week
  sums, rounding only at display, null versus zero, partial propagation,
  text/deleted entries, and all eight nutrient keys.
- Workers-runtime tests with the existing D1 fixture for a week near the
  date boundary, authorization and revoked membership, cross-household
  isolation, malformed/duplicate/unknown `week`, changed ingredient text,
  missing servings, missing USDA nutrients, recipe deletion, and updates
  after a match or plan change. Compare the route's per-recipe numbers with
  `GET /api/recipes/{id}/nutrition` to detect a formula divergence.
- Playwright on Chromium and WebKit, including phone view: checked recipes
  yield a daily and weekly estimate; an incomplete recipe creates a clear
  gap and a working recipe link; a plan mutation refreshes the estimate;
  nutrition failure leaves the plan usable. No paid or remote service is
  called.
- Development validation: owner checks a phone week with a checked recipe,
  an incomplete recipe, a free-text entry, and a repeated recipe; review
  content-free latency and CPU evidence for the bounded endpoint. Production
  remains subject to separate owner approval and a phone smoke test.

## Traceability

Paths and test names below are the implementation plan, not passing evidence.
Update them with exact symbols and test names in the implementation PR.

| Criterion | Planned implementation                                                                                                       | Planned automated tests                                                                                                                                                                                                                       | Release evidence |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `AC-01`   | `src/shared/meal-plan-nutrition.ts`; `src/worker/data/meal-plan-nutrition-repository.ts`; `src/client/MealPlanNutrition.tsx` | `src/shared/meal-plan-nutrition.test.ts` — “sums daily and weekly nutrients”; `test/worker/meal-plan-nutrition.test.ts` — “returns the eight nutrients for a week”; `tests/e2e/meal-plan.spec.ts` — “shows day and week nutrition on a phone” | Pending          |
| `AC-02`   | `src/shared/meal-plan-nutrition.ts` — entry aggregation                                                                      | `src/shared/meal-plan-nutrition.test.ts` — “counts repeated recipes and excludes text and deleted entries”                                                                                                                                    | Pending          |
| `AC-03`   | `src/shared/meal-plan-nutrition.ts` — coverage and partial flags; `src/client/MealPlanNutrition.tsx` — gap links             | `src/shared/meal-plan-nutrition.test.ts` — “keeps known values and marks gaps”; `tests/e2e/meal-plan.spec.ts` — “links an incomplete estimate to its recipe”                                                                                  | Pending          |
| `AC-04`   | `src/worker/data/meal-plan-nutrition-repository.ts` — current-data read                                                      | `test/worker/meal-plan-nutrition.test.ts` — “updates after recipe and plan changes” and “matches the recipe nutrition formula”                                                                                                                | Pending          |
| `AC-05`   | `src/worker/index.ts` — authorized route and query validation; repository household joins                                    | `test/worker/meal-plan-nutrition.test.ts` — “rejects non-members and isolates households” and “bounds and validates the week”                                                                                                                 | Pending          |
| `AC-06`   | `src/client/MealPlanNutrition.tsx`; `src/client/MealPlan.tsx` — independent load and retry                                   | `src/client/MealPlanNutrition.test.tsx` — “keeps the plan usable when nutrition fails”; `tests/e2e/meal-plan.spec.ts` — “shows day and week nutrition on a phone”                                                                             | Pending          |
| `AC-07`   | Shared, Worker, and client boundaries above                                                                                  | All named tests above and the full CI `Verify` browser matrix                                                                                                                                                                                 | Pending          |

## Rollout and rollback

The design PR contains no app or database changes. After owner acceptance,
an implementation PR can add the read-only endpoint and UI. No migration,
secret, provider, or dataset load is needed under the provisional portion
rule. Verify must pass on the implementation PR with Sonar Quality Gate and
security review. Deploy to development first, validate the phone scenarios
and bounded CPU behavior, and record the result. Production deployment
requires explicit owner approval; it does not follow from design acceptance.
The code can be rolled back by redeploying the previous Worker, with no data
recovery because no stored format changes.

## Open owner decision

**What does one planned recipe entry contribute?** The current plan stores
no portion count and represents a shared household plan. This design
recommends **one serving per recipe entry**, with the one-person estimate
wording above. It is the smallest useful release slice and needs no
migration. Alternatives are **the whole recipe** (a family-batch estimate)
or **editable portions per entry** (more accurate for varying meals, but a
new field, migration, edit UI, conflict handling, and additional tests).
The owner has been asked to choose. No design status change to `Accepted`
or implementation should occur until the choice is recorded here and in
issue #98.

## Decision and change log

| Date       | Change                                                                                                                                               | Reason                                                                                      | Evidence                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-27 | Propose a read-only daily and weekly estimate over current plan entries and saved recipe matches, with one serving per entry as the provisional rule | Ship the next major nutrition capability using the released #49 and #84 data and boundaries | [Issue #98](https://github.com/wpliao/meal-planner/issues/98); [design PR #99](https://github.com/wpliao/meal-planner/pull/99) |

## Release record

- Development validation: Pending
- Production release: Pending
- Known follow-up work: Decide only after validation; no additional scope is authorized by this design.
