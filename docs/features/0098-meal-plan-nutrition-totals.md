# Feature: Daily and weekly meal-plan nutrition totals

- Status: Released
- Phase: 6 — structured nutrition
- Issue: [#98](https://github.com/wpliao/meal-planner/issues/98)
- Product owner: Repository owner
- Last updated: 2026-09-28
- Pull requests: [#99 — accepted design](https://github.com/wpliao/meal-planner/pull/99); [#100 — implementation](https://github.com/wpliao/meal-planner/pull/100); [#101 — development fixture](https://github.com/wpliao/meal-planner/pull/101)

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
dataset, targets, or tracking workflow. The owner chose
[one serving per planned recipe entry](#resolved-portion-decision). The
owner accepted this full design on 2026-09-27. Acceptance authorizes
implementation after the design PR merges; it does not authorize a
development or production deployment.

## User scenarios

1. Given a week with checked recipes, when a member opens its plan, then they
   see an estimate for each day and the Monday–Sunday week, with the existing
   eight nutrients and energy in kJ and kcal.
2. Given the same recipe planned twice, when totals are calculated, then
   each entry contributes one serving. A moved or
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

These stable identifiers mirror [issue #98](https://github.com/wpliao/meal-planner/issues/98).

- [ ] `AC-01`: The week view displays estimated values for the eight existing
      NZ/AU panel nutrients for each day and the displayed Monday–Sunday
      week, with energy in kJ and kcal, using only saved current recipe
      matches and USDA reference values.
- [ ] `AC-02`: Each planned recipe entry contributes one serving of its
      linked recipe. Repeated entries each contribute one serving. Free-text
      entries and deleted recipes contribute no numeric value and are
      identified as gaps.
- [ ] `AC-03`: The view distinguishes a complete estimate from partial data:
      unchecked, changed, or deliberately uncounted ingredient lines and
      missing USDA nutrient values mark known values as partial; a recipe
      without servings contributes no number. No gap is treated as zero, and
      a member can navigate to a live recipe to address it.
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
sentence **Based on one serving of each included recipe entry**. The section
says how many of the week's planned
entries contributed. A day card gains a compact **Day nutrition estimate**
line after its meal controls, with energy, protein, and coverage; an expandable
table shows all eight rows. The week table remains visible. A member can open a day's details with
keyboard or touch, and neither table uses color alone to convey status.

The language names the denominator: **X of Y planned entries included**.
`Y` includes recipe and free-text entries; `X` counts recipe entries with at
least one current counted ingredient, a servings count, and a per-serving
estimate. Repeated entries count separately. The section lists gaps by day
and entry, using the plan's existing display title and a reason:

- **Add servings** when a live recipe has counted nutrition but no servings;
  it contributes no value under the one-serving rule.
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
separate states, so a slow calculation does not hide the week. A pending read
for a nonempty week reserves the eight table rows, keeping meal controls in
place. After a plan mutation, the client refreshes both reads and keeps the
previous estimate visible until the next result arrives; a member can also refresh the
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

**Owner decision:** each plan entry represents one serving of its linked
recipe. A recipe with `servings = 4` contributes one quarter of
its whole-recipe known values for each entry. The daily total sums entries
on that date across breakfast, lunch, and dinner. The week sums the seven
unrounded daily totals. Two entries for the same recipe contribute twice.
The result is an illustrative one-person menu; it does not claim to be a
household total or an intake record. The section and API contract must say
this explicitly.

The aggregation preserves `null` separately from known zero. If a recipe
or nutrient has no known value, it adds no number and lowers coverage. A
partially known recipe contributes the known amount and marks the affected
day and week nutrient as partial. An unchecked or changed ingredient, or
one deliberately not counted, makes the affected recipe's estimate partial
for all nutrients because its contribution is unknown. A nutrient missing
from one counted USDA food makes that row partial. The summary never fills
gaps with AI output or a guessed amount.

### Data and migrations

Under the chosen one-serving rule, no schema change is needed. The
endpoint derives its response from the current plan entries, recipes,
ingredient lines, confirmed matches, and global USDA reference tables.
It writes no snapshot, personal consumption record, or audit row. Existing
retention and deletion rules remain: removing a plan entry removes its
contribution on the next read; recipe deletion retains the plan title but
sets its link to `NULL`; household decommission deletes plan entries and
matches. The plan does not gain an editable portion count.

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

The implementation PR records the exact code and automated checks here. The
issue comments link the development checks and production release for each
accepted criterion.

| Criterion | Implementation                                                                                                                                                                                                                | Automated tests                                                                                                                                                                                                                                                                                                                                                           | Release evidence                                                                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-01`   | `aggregateMealPlanNutrition` in `src/shared/meal-plan-nutrition.ts`; `readMealPlanNutrition` in `src/worker/data/meal-plan-nutrition-repository.ts`; `WeekNutrition` and `DayNutrition` in `src/client/MealPlanNutrition.tsx` | `src/shared/meal-plan-nutrition.test.ts` — “includes every panel nutrient”, “adds one serving for each repeated entry and names exclusions”; `test/worker/meal-plan-nutrition.test.ts` — “sums one serving per entry and matches the recipe nutrition formula”; `tests/e2e/meal-plan.spec.ts` — “shows day and week nutrition on a phone and refreshes after a plan edit” | [V-DEV phone](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858111014); [R-PROD phone](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858309554)                                                                                             |
| `AC-02`   | `aggregateMealPlanNutrition` and `reasonForEntry` in `src/shared/meal-plan-nutrition.ts`                                                                                                                                      | `src/shared/meal-plan-nutrition.test.ts` — “adds one serving for each repeated entry and names exclusions”; `test/worker/meal-plan-nutrition.test.ts` — “treats removed foods and recipes as gaps without inventing values”                                                                                                                                               | [V-DEV phone](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858111014); [R-PROD phone](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858309554)                                                                                             |
| `AC-03`   | `reasonForEntry` and `addEntry` in `src/shared/meal-plan-nutrition.ts`; `Gaps` and `Amount` in `src/client/MealPlanNutrition.tsx`                                                                                             | `src/shared/meal-plan-nutrition.test.ts` — “keeps known zero separate from gaps and propagates missing USDA values”, “excludes a recipe with no servings while preserving another known amount”; `tests/e2e/meal-plan.spec.ts` — “shows day and week nutrition on a phone and refreshes after a plan edit”                                                                | [V-DEV phone](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858111014); [R-PROD phone](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858309554)                                                                                             |
| `AC-04`   | `readMealPlanNutrition` in `src/worker/data/meal-plan-nutrition-repository.ts`                                                                                                                                                | `test/worker/meal-plan-nutrition.test.ts` — “drops a changed match and reflects current servings and plan entries”, “sums one serving per entry and matches the recipe nutrition formula”                                                                                                                                                                                 | [V-DEV phone](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858111014); [production deploy](https://github.com/wpliao/meal-planner/actions/runs/36338395179)                                                                                                 |
| `AC-05`   | `handleMealPlanNutrition` in `src/worker/index.ts`; `nutritionWeekQuery` in `src/shared/meal-plan-nutrition.ts`; household joins in `readMealPlanNutrition`                                                                   | `test/worker/meal-plan-nutrition.test.ts` — “never returns another household’s entries or recipe nutrition”, “validates one Monday and denies revoked members”; `src/shared/meal-plan-nutrition.test.ts` — “accepts exactly one Monday date”                                                                                                                              | [production Access check](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858297657); [R-PROD phone](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858309554)                                                                                 |
| `AC-06`   | `useMealPlanNutrition` in `src/client/useMealPlanNutrition.ts`; `WeekNutrition` and `DayNutrition` in `src/client/MealPlanNutrition.tsx`; `Week` in `src/client/MealPlan.tsx`                                                 | `src/client/MealPlanNutrition.test.tsx` — “reserves the week table while nutrition is still loading”, “shows eight week rows, a day disclosure, and an actionable gap”, “keeps the plan usable after nutrition fails and can retry”; `tests/e2e/meal-plan.spec.ts` — “shows day and week nutrition on a phone and refreshes after a plan edit”                            | [V-DEV phone](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858111014); [R-PROD phone](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858309554)                                                                                             |
| `AC-07`   | Shared aggregation, Worker route/repository, and independent client read above                                                                                                                                                | All named tests above; `test/worker/meal-plan-nutrition.test.ts` — “reads a full 126-entry week with two prepared queries”; full CI `Verify` browser matrix and Sonar Quality Gate                                                                                                                                                                                        | [near-limit measurement](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858261028); [main Verify](https://github.com/wpliao/meal-planner/actions/runs/36336063703); [R-PROD deploy](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858297657) |

## Rollout and rollback

The design PR contains no app or database changes. After it merges, an
implementation PR can add the read-only endpoint and UI. No migration,
secret, provider, or dataset load is needed under the chosen portion
rule. Verify must pass on the implementation PR with Sonar Quality Gate and
security review. Deploy to development first, validate the phone scenarios
and bounded CPU behavior, and record the result. Production deployment
requires explicit owner approval; it does not follow from design acceptance.
The code can be rolled back by redeploying the previous Worker, with no data
recovery because no stored format changes.

The repeatable [development nutrition fixture](../operations/development-nutrition-fixture.md)
creates two synthetic weeks for the owner phone scenarios and near-limit
measurement. Its development-only workflow checks that both weeks are empty,
seeds no family recipe content, and cleans only its own deterministic IDs.

## Resolved portion decision

The owner chose **one serving per planned recipe entry** on 2026-09-27.
The current plan stores no portion count and represents a shared household
plan. This choice makes the totals an illustrative one-person menu and keeps
the release slice read-only, with no migration. Whole-recipe totals and
editable portions were considered but are outside this feature. The owner
accepted the full design, including its experience, contracts, and
incomplete-value policy, on 2026-09-27.

## Decision and change log

| Date       | Change                                                                                                                                                     | Reason                                                                                                                          | Evidence                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-27 | Propose a read-only daily and weekly estimate over current plan entries and saved recipe matches, with one serving per entry as the provisional rule       | Ship the next major nutrition capability using the released #49 and #84 data and boundaries                                     | [Issue #98](https://github.com/wpliao/meal-planner/issues/98); [design PR #99](https://github.com/wpliao/meal-planner/pull/99)                                                                                                                                 |
| 2026-09-27 | Choose one serving per planned recipe entry; keep the design in `Designing` pending full acceptance                                                        | The plan is shared and has no portion field; one serving gives an understandable per-person planning estimate without migration | Product owner's Codex reply on 2026-09-27; [issue #98](https://github.com/wpliao/meal-planner/issues/98)                                                                                                                                                       |
| 2026-09-27 | Accept the full design and stabilize `AC-01`–`AC-07` without changing their identifiers                                                                    | The owner explicitly accepted the design after choosing the one-serving rule                                                    | Product owner's Codex reply on 2026-09-27; [issue #98](https://github.com/wpliao/meal-planner/issues/98)                                                                                                                                                       |
| 2026-09-27 | Begin the read-only implementation after design PR #99 merged; retain the accepted portion and gap rules                                                   | The accepted design is now on `main` and needs an independently reviewable code PR                                              | [Design PR #99](https://github.com/wpliao/meal-planner/pull/99); [implementation PR #100](https://github.com/wpliao/meal-planner/pull/100)                                                                                                                     |
| 2026-09-27 | Reserve the week table during a pending nutrition read, keep the previous estimate during refresh, and place day details after meal controls               | A late nutrition response moved an open plan menu in WebKit; the plan must remain usable while this independent read completes  | Local full browser run on 2026-09-27; `src/client/MealPlanNutrition.test.tsx` — “reserves the week table while nutrition is still loading”                                                                                                                     |
| 2026-09-27 | Add a development-only synthetic fixture with a six-entry phone week and a 126-entry measurement week; no acceptance criterion or product behavior changed | Make development validation repeatable without using family meal content or leaving untracked test recipes                      | [Fixture runbook](../operations/development-nutrition-fixture.md); issue #98                                                                                                                                                                                   |
| 2026-09-28 | Accept development validation after the owner passed both phone weeks and measured five near-limit requests; clean the synthetic fixture                   | Exercise the accepted scenarios and bound the production CPU and response-time risk with content-free evidence                  | [Phone result](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858111014); [measurements](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858261028); [cleanup](https://github.com/wpliao/meal-planner/actions/runs/36338240992) |
| 2026-09-28 | Release the accepted implementation to production after explicit owner approval and a passing authenticated phone smoke test                               | Make daily and weekly plan nutrition available with the existing one-serving rule and no schema change                          | [Production deployment](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858297657); [phone smoke](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858309554)                                                                     |

## Release record

- **Development validation (2026-09-28):** [Deploy run
  36319979355](https://github.com/wpliao/meal-planner/actions/runs/36319979355)
  published implementation commit `3973d31` to development. The protected
  [fixture seed run
  36336424954](https://github.com/wpliao/meal-planner/actions/runs/36336424954)
  verified 46 synthetic recipes, 341 ingredient lines, 340 matches, and 132
  plan entries across the six-entry phone week and the 126-entry load week.
  The owner [passed both authenticated phone
  checks](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858111014)
  without an apparent error. Five near-limit nutrition requests each returned
  HTTP 200, with [paired Worker CPU times of 4–7 ms and browser Network
  timings of 56.51–63.76
  ms](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858261028).
  The protected [cleanup run
  36338240992](https://github.com/wpliao/meal-planner/actions/runs/36338240992)
  verified zero fixture recipes, lines, matches, and plan entries remain.
- **Production release (2026-09-28):** After explicit owner approval, the
  protected [Deploy run
  36338395179](https://github.com/wpliao/meal-planner/actions/runs/36338395179)
  published `c8bdba5901650ffe486f84135abe307eba2e0821` as Worker version
  `deff8436-7c2e-4e0a-9b43-fc699ca0925b`. The run reused the passing
  [main `Verify`
  run](https://github.com/wpliao/meal-planner/actions/runs/36336063703),
  found no migrations to apply, and confirmed the pinned USDA dataset was
  already loaded. Unauthenticated health and nutrition requests returned the
  expected Access redirects. The owner [passed the authenticated production
  phone smoke
  test](https://github.com/wpliao/meal-planner/issues/98#issuecomment-5858309554).
  The previous production Worker version is
  `25965efb-8225-41ad-b22e-2913cd165de0`; rollback needs a Worker
  redeploy, with no data rollback for this read-only feature.
- **Known follow-up work:** None identified for this feature.
