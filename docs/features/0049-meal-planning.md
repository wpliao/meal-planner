# Feature: Meal planning

- Status: Implementing
- Phase: 4 — meal planning
- Issue: [#49](https://github.com/wpliao/meal-planner/issues/49)
- Product owner: Repository owner
- Last updated: 2026-09-24
- Pull requests: [#50 — design proposal](https://github.com/wpliao/meal-planner/pull/50); [#51 — migration and API](https://github.com/wpliao/meal-planner/pull/51); [#52 — week view, dialogs, and Add to plan](https://github.com/wpliao/meal-planner/pull/52); [#53 — UI refinements from V-DEV-P1](https://github.com/wpliao/meal-planner/pull/53)

## Problem and outcome

The family keeps a pantry and a recipe library but has no shared place to
decide what it will eat and when. Plans live in heads, chats, or on paper, so
a member cannot see what is planned for tonight or later in the week, and
cannot easily record that Thursday is leftovers or that Saturday is the new
recipe.

The outcome is one private, shared plan. Any active member can place
household recipes and simple free-text meals onto the days and meals of a
week, change them as plans change, and see the current week at a glance on a
phone.

The product owner resolved all eight open design decisions on 2026-09-24; see
[Resolved design decisions](#resolved-design-decisions). The owner [accepted this
design](https://github.com/wpliao/meal-planner/issues/49#issuecomment-5806668289) on 2026-09-24. Acceptance
authorizes implementation only. It does not authorize applying migration `0004`
remotely, deploying, or changing production, which keep their existing
approval gates.

## User scenarios

1. Given an active member, when they open the plan on a phone, then they see
   this week's days with each day's breakfast, lunch, and dinner, and today is
   easy to find.
2. Given a household recipe, when a member adds it to Thursday's dinner from
   the plan or from the recipe's own page, then everyone sees it there and can
   open the recipe from the plan.
3. Given no recipe for a meal, when a member types "Leftovers" or "Eat out",
   then that free-text entry is planned without creating a recipe.
4. Given changed plans, when a member moves a meal to another day or meal, or
   removes it, then everyone sees the change. If another member changed it
   first, the older change fails with the latest version shown, and nothing
   is silently overwritten.
5. Given a link to a particular week, when a member opens it, then that week
   is shown, and previous/next week and the device back button behave
   predictably.
6. Given a planned recipe that is later deleted from the library, when a
   member views the plan, then the entry still shows the recipe's last title,
   marked as no longer in the library, without a broken link.
7. Given a non-member or an identity without a valid Access assertion, when
   they request the plan, then no household data is disclosed.

## Scope

- Included: a week view of plan entries; adding a household recipe or a
  free-text meal to a date and meal slot, from the plan or from a recipe's
  page; moving, editing, and removing entries with conflict protection; week
  navigation by URL; responsive, accessible states; and a new household-owned
  table in the #32 decommission inventory.
- Not included: suggestions or automatic plan generation (Phase 5),
  nutrition (Phase 6), AI (Phase 7), servings or headcount scaling, pantry
  deduction or automatic shopping-list changes, copying or repeating weeks,
  drag-and-drop, calendar export or sync, notifications, per-member plans,
  and offline editing.

## Acceptance criteria

These stable identifiers mirror
[issue #49](https://github.com/wpliao/meal-planner/issues/49). `AC-06` and
`AC-07` were reworded before acceptance to follow decision 6. No criterion is
complete yet.

- [ ] `AC-01`: Active members can view, add, change, and remove only their
      household's plan entries; unauthenticated visitors and non-members
      cannot read or change them.
- [ ] `AC-02`: A week view shows every day's meal slots and their entries,
      moves to the previous, next, and current week through real URLs, and
      works on phone and desktop with loading, empty, success, validation,
      and failure states.
- [ ] `AC-03`: A member can place a household recipe on a date and meal, from
      the plan or from the recipe's page, and open that recipe from the plan.
      A member can also add a free-text entry with no recipe.
- [ ] `AC-04`: A member can move an entry to another date or meal, edit its
      text or note, and remove it. Stale changes return a recoverable
      conflict and never silently overwrite a newer change.
- [ ] `AC-05`: Deleting a recipe leaves its plan entries readable under the
      recipe's last title, marked as no longer in the library. A plan entry
      can never refer to another household's recipe.
- [ ] `AC-06`: Plan data is household scoped in D1 and bounded by date
      window, per-meal, and per-household limits. It is kept until a
      member removes it or the household is deleted, is counted and removed by the household decommission
      procedure, and is never written to logs.
- [ ] `AC-07`: Deterministic tests cover the migration, authorization and
      isolation, conflicts, recipe-deletion effects, limits, the
      decommission inventory, local-date handling, and the primary browser
      journeys on Chromium and WebKit. Development and production validation
      evidence is recorded before release.

## Experience design

A **Plan** section joins the navigation from
[ADR 0007](../DECISIONS/0007-navigation-and-information-architecture.md).
By [decision 8](#resolved-design-decisions) it becomes the
landing page, and the navigation order is Plan, Pantry, Recipes, Family.

**Week view.** `/plan` shows the current week. `/plan/2026-09-21` shows the
week starting on that date. The week starts on Monday ([decision 1](#resolved-design-decisions)). The header names the week
("21–27 September 2026") and offers **Previous week**, **This week**, and
**Next week**, and each is a real navigation, so back returns to the week
before. A date in the URL that is not a week's first day is replaced with its
week's first day. An invalid date is replaced with the current week.

Each day is a card headed by its weekday and date, with today marked "Today".
Inside each card are the three meal slots, **Breakfast**, **Lunch**, and
**Dinner** ([decision 2](#resolved-design-decisions)). Each
slot lists its entries in the order they were placed, followed by an **Add**
button. A recipe entry shows the recipe's current title as a link to the
recipe. A free-text entry shows its text. Either may show a short note, such
as "double batch". An entry whose recipe was deleted shows its last title and
"No longer in the recipe library", with no link.

On a phone the days form a single column, and the view scrolls to today when
the current week opens. On wider screens the day cards sit in a responsive
grid. The pantry layout already avoids narrow columns, and this view follows
it. An empty week still shows every day and slot with its Add button, and one
line says nothing is planned yet. Loading and failure follow the pantry and
recipe patterns: a loading state, and a failure message with **Try again**.

**Adding.** Add opens a dialog for that date and slot with two choices:

- **Pick a recipe**: one searchable field over the household's recipe titles.
  Its dropdown shows only the titles that match what the member types and
  scrolls within a fixed height, so the dialog stays short however large the
  library grows. If the library is empty, the dialog says so and links to Add
  recipe.
- **Type a meal**: a text field, 1–120 characters, such as "Leftovers".

Either choice allows an optional one-line note of up to 200 characters. Saving closes
the dialog, shows the entry in its slot, announces the result, and returns
focus to that slot's Add button.

A recipe's detail page gains **Add to plan**. It opens a dialog with a date
(default today) and a meal (default Dinner). After saving, it offers a link
to that week.

**Changing.** Each entry has a menu with:

- **Move**: a dialog with a date and a meal.
- **Edit**: the text for a free-text entry, and the note for either kind.
- **Remove**: a focus-trapped confirmation that names the entry.

Moving places the entry last in its new slot. A slot that already holds its
maximum number of entries refuses more and says why. A stale change shows
that someone else changed the entry, with its latest date, meal, and text. It
also offers the choice to apply the member's change to the latest version,
matching the recipe editor's conflict panel. A stale remove keeps the entry
and shows its latest version. An entry already removed by someone else
disappears, with a notice.

Dates are always the family's **local calendar days**. "Today" comes from the
device's clock and time zone. An entry for Thursday stays on Thursday for
every member, whatever time it is saved (see
[Time and dates](#time-and-dates)).

Validation messages sit next to their control, typed text survives a failed
save, and every control has a 44px minimum target.

## Technical design

### Boundaries and contracts

The client adds `/plan` and `/plan/:weekStart` under the authenticated layout,
plus the Add to plan dialog on `/recipes/:id`. A new
`src/shared/meal-plan.ts` holds the contracts, bounds, date validation, and
week arithmetic, so the client and Worker share one definition. The Worker
reuses the verified identity and active-membership boundary from
[ADR 0004](../DECISIONS/0004-access-identity-and-household-authorization.md)
on **every** plan request. Household scope always comes from `MemberContext`,
never from a URL or request body.

API:

- `GET /api/meal-plan?from=YYYY-MM-DD&to=YYYY-MM-DD` returns the entries in an
  inclusive date range of at most 42 days, ordered by date, slot, and
  placement. Each entry carries its ID, date, slot, kind (`recipe` or
  `text`), display title, recipe ID and a `recipeRemoved` flag for recipe
  entries, note, version, and update time. The display title of a recipe
  entry is the recipe's current title, read through a household-scoped join.
- `POST /api/meal-plan/entries` takes a date, slot, optional note, and either
  `recipeId` or `title`.
- `PATCH /api/meal-plan/entries/:id` takes `version` and any of date, slot,
  note (or `null` to clear it), and, for text entries only, `title`.
- `DELETE /api/meal-plan/entries/:id` takes `version`.

A `PATCH` that changes the date or meal is a move: the entry goes last in its
new meal. The read accepts exactly `from` and `to`, once each, and rejects
any other query parameter.

Mutations keep the existing same-origin and JSON content-type checks and the
default body limit. A stale `PATCH` or `DELETE` returns `409 stale_version`
with the current entry. A missing entry, or one from another household,
returns a non-disclosing `404`. A full slot or household returns `409
limit_reached` with a message that contains no plan text. A `recipeId` that
does not name a recipe in the caller's household returns `404`, the same as
for a recipe that does not exist. Entries are never returned for another
household, including through the recipe join. The recipe picker reuses
`GET /api/recipes`. No new external call is made.

### Time and dates

A plan date is a calendar date string `YYYY-MM-DD` with **no time and no time
zone**. The client computes today and the week from the device's local date.
The Worker stores and returns the string unchanged, so no time-zone
conversion can move an entry to another day. There is no household time-zone
setting. The only use of the server clock is the write window (below). It
compares against the UTC date with one day of slack on each side, so a family
in any time zone can always plan its own today. Week arithmetic is done on
calendar dates, not timestamps, so daylight-saving changes cannot skip or
repeat a day.

Write window: an entry can be placed on any date from **8 weeks ago** to **52
weeks ahead**. The window applies to the date an entry is created on or moved
to. Editing the text or note of an older entry that stays on its date is
allowed, and so is moving it to another meal on that same date (owner answer
during implementation, 2026-09-24): the date does not change, so it cannot be
a mistyped date. Reads may cover any date. The window only guards against mistyped
dates, such as a wrong year. It is not a retention rule, and it is a
reversible default for owner review, because
[decision 6](#resolved-design-decisions) chose to keep entries without
time-based deletion.

### Data and migrations

The forward migration `0004_create_meal_plan_entries.sql` is created in
[#51](https://github.com/wpliao/meal-planner/pull/51) and **not yet applied**
to any remote environment. It is additive and alters no existing table.

```text
households (1) ──< meal_plan_entries (*) >── (0..1) recipes
                     household_id → households.id   ON DELETE CASCADE
                     recipe_id    → recipes.id      ON DELETE SET NULL
```

Proposed columns:

| Column         | Type and constraint                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `id`           | Opaque text primary key                                                                        |
| `household_id` | Not null; references `households(id)` `ON DELETE CASCADE`                                      |
| `plan_date`    | Not null; `YYYY-MM-DD`, `CHECK (date(plan_date) IS plan_date)` rejects impossible dates        |
| `meal_slot`    | Not null; `CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner'))`                              |
| `kind`         | Not null; `recipe` or `text`                                                                   |
| `recipe_id`    | Nullable; references `recipes(id)` `ON DELETE SET NULL`; must be null for `text`               |
| `title`        | Not null, 1–120 characters: the text, or the recipe's title when placed or when it was deleted |
| `note`         | Nullable, 1–200 characters, one line                                                           |
| `placed_at`    | Not null; set on create and on every move; orders entries within a slot                        |
| `version`      | Not null, positive; increments on every change                                                 |
| `created_at`   | Not null                                                                                       |
| `updated_at`   | Not null                                                                                       |

An index on `(household_id, plan_date)` serves the week read and the limits,
and an index on `recipe_id` serves `ON DELETE SET NULL`, which would otherwise
scan the table on every recipe delete. The table is `STRICT`, like the others.

The migration test proves that D1 accepts a `CHECK` using `date()`, and it
found that the originally proposed `date(plan_date) = plan_date` is not
enough. `date()` rolls an impossible date such as `2026-02-30` forward, so
that comparison fails as intended, but it returns `NULL` for malformed text
such as `2026-2-3`, and a `CHECK` whose result is `NULL` passes. The
migration therefore uses `IS`, which treats `NULL` as a mismatch and rejects
both.

**Recipe references and household scope.** A foreign key cannot require that
a recipe belongs to the same household. The Worker therefore inserts or
changes a recipe entry only through `INSERT … SELECT` or `UPDATE … WHERE
EXISTS` statements that require `recipes.household_id` to equal the caller's
household. Reads join recipes on both ID and household. A Workers-runtime test
proves that another household's recipe ID is refused and never disclosed.

**Recipe deletion** ([decision 4](#resolved-design-decisions)).
`ON DELETE SET NULL` keeps the entry and drops the link. So that the entry
shows the recipe's _last_ title rather than its title when placed, the recipe
delete becomes a batch. The first statement refreshes `title` on that
recipe's entries, guarded by the same household, ID, and version as the
delete. The second is the existing version-guarded `DELETE`. A stale delete
therefore changes nothing. `kind` stays `recipe`, and a recipe entry whose
`recipe_id` is null is reported as `recipeRemoved`. The refresh does not
change an entry's version, because its content is unchanged; a member's open
edit of that entry still saves. Renaming a recipe needs no
change, because reads use the live title.

**Limits**: at most **6 entries per slot per day**, and at most
**4,000 entries per household**. Both are enforced by guarded
`INSERT … SELECT` and `UPDATE` statements, so concurrent writes cannot exceed
them. Bounds live in `src/shared/meal-plan.ts`, and the migration's `CHECK`
constraints mirror the storage bounds.

**Retention** ([decision 6](#resolved-design-decisions)). Entries are kept
until a member removes them or the household is deleted. There is no
time-based deletion, and the 4,000-entry household limit is the bound on
stored history. At about three entries a day, a household reaches the limit
after roughly three and a half years. From then on, adding an entry fails with
`limit_reached`, and the message says to remove old entries first; moving and
editing still work. Removing thousands of entries one at a time would be
slow, so a bulk "clear a past week" action is recorded as
[follow-up work](#release-record) rather than built now. Removing an entry
deletes its row; there is no tombstone or edit history. As with the pantry and
recipes, deletion from the live table does not erase D1 Time Travel history,
which lasts 7 days on the current Workers Free plan.

**Household deletion.** `meal_plan_entries.household_id` cascades from
`households`, so the accepted operator batch in
[ADR 0008](../DECISIONS/0008-household-decommissioning.md) removes every entry
unchanged. The pull request that adds `0004` must also update
`src/operations/household-decommission/`, as the
[#32 release record](./0032-household-lifecycle.md#release-record) requires.
The work covers `HOUSEHOLD_COUNTS_SQL` and `COUNT_FIELDS`,
`acceptableDeletionChanges`, and `EXPECTED_TABLES` in `sql.ts`, and the
preflight's all-rows-belong-to-the-target check in `procedure.ts`. The owner
summary in the [runbook](../operations/household-decommission.md) must also
name meal plans. One point needs a Workers-runtime test: deleting a household
cascades to both its recipes, which sets entries' `recipe_id` to null, and
its entries, which deletes them. The affected-row count that D1 reports for
that combination must be measured before `acceptableDeletionChanges` accepts
it. Measured in the Workers runtime: each entry is counted once, as a deleted
row. The cascade deletes the entries before the recipes, so `SET NULL` finds
no entry to update, and the accepted cascade-inclusive count adds only the
target household's entry count. A recipe deleted on its own does count each
entry it sets to null. Production deletion stays refused, as #32 closed it.

`docs/DATA_MODEL.md` gains a Phase 4 section in the implementation pull
request.

### Security and privacy

A meal plan reveals family routines, preferences, and when people eat at
home. Reads and writes use prepared statements scoped to the verified
household. No plan text, note, date, recipe title, or member identity appears
in application logs or error messages. Every write validates types, the date
format and window, the slot, the kind, and text bounds at the API boundary.
Text is normalized with the recipe rules (NFC, control characters removed,
whitespace collapsed). The client renders every field as plain text, never
through `innerHTML`, which matters under the current Content Security Policy
(see [ADR 0006](../DECISIONS/0006-component-library.md) and
[SECURITY.md](../SECURITY.md)). The feature makes no external request and
sends nothing to a third party. Who may edit follows
[decision 5](#resolved-design-decisions): every active member, as for the
pantry and recipes.

### Accessibility

Each day is a section with a heading (weekday and full date), and each slot a
labelled list. Add buttons have specific names, for example "Add to dinner,
Thursday 24 September". Moving uses a dialog with a native date field and a
meal select, not drag-and-drop, so it works by keyboard and screen reader.
Dialogs trap focus and return it to the control that opened them, or to the
slot's Add button when the entry left the slot. Results and conflicts are
announced through the existing live region. "Today" is conveyed in text as
well as by style. Contrast and visual snapshots are checked on Chromium and
WebKit at desktop and phone sizes.

### Reliability and observability

Every write is one D1 batch, which is a transaction. Creates are not
idempotent: a retried create after a lost response can add a duplicate entry,
which the member can see and remove. The proposal accepts this, as the pantry
and recipes do. Failed writes keep the member's input. The week view reloads
after a conflict or a `404`. Outcome counts may be recorded without plan
content. The week read is bounded to 42 days and the per-household limit
bounds the table, so cost stays small and predictable.

## Test strategy

- Shared unit tests for date validation (including leap days and impossible
  dates), week start and range arithmetic across month, year, and
  daylight-saving boundaries, bounds, and request validation.
- Workers-runtime tests for:
  - migration constraints, the `date()` check, both cascades, and
    `SET NULL`
  - authorization for members, revoked members, non-members, and
    unauthenticated requests
  - cross-household entry and recipe IDs
  - stale updates and deletes, and concurrent moves into a nearly full slot
  - household and slot limits, the message at the household limit, and
    the write window
  - the recipe-deletion title refresh, including a stale recipe delete
  - the decommission counts, including the combined cascade's affected rows
  - no plan content in logs
- Client unit tests for the week view, the add, move, edit, and remove
  dialogs, conflict handling, and the recipe picker. A plain Vitest test
  covers each UI branch, because Sonar's new-code coverage counts only
  Vitest.
- Playwright on Chromium and WebKit, desktop and phone:
  - plan a recipe and a free-text meal, move one, edit a note, and remove one
  - add to the plan from a recipe page
  - a stale change from a second page
  - a deleted recipe's entry
  - deep links to a week, week navigation, and the back button
  - phone layout and touch targets, keyboard-only flow, and visual snapshots
  - an emulated `timezoneId` far from UTC (for example `Pacific/Auckland` and
    `America/Los_Angeles`) near midnight, proving that today and saved dates
    follow the device's local day
- Development validation on real phones with real Access identities, recorded
  separately from automated results.

## Traceability

The implementation is two pull requests: first the migration, shared
contracts, API, recipe-delete change, and decommission inventory
([#51](https://github.com/wpliao/meal-planner/pull/51)); then the week view,
dialogs, and Add to plan ([#52](https://github.com/wpliao/meal-planner/pull/52)).
No criterion is complete until its development and production evidence
exist.

| Criterion | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Release evidence |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `AC-01`   | `handleMealPlan`, `handleMealPlanEntries`, `handleMealPlanEntry` in `src/worker/index.ts` (verified member on every request; household from `MemberContext`); `src/worker/data/meal-plan-repository.ts` (every statement scoped by household); `/plan` routes inside the authenticated `AppLayout` in `src/client/App.tsx`                                                                                                                                                                                                               | `test/worker/meal-plan.test.ts` — `never lets one household read or change another household's entries`; `denies a revoked member every plan route`; `denies an identity that belongs to no household`; `denies a request without a valid Access assertion`; `lets a regular member manage the shared plan`; `requires same-origin JSON for every plan mutation`; `tests/e2e/meal-plan.spec.ts` — `a non-member sees no plan and the plan is never requested`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pending          |
| `AC-02`   | `src/shared/meal-plan.ts` — `planWeekStart`, `planWeekDates`, `addPlanDays`, `localPlanDate`; `GET /api/meal-plan` with `validateMealPlanRange` (≤ 42 days); `MealPlan` and `Week` in `src/client/MealPlan.tsx` (day cards, meal lists, Today, loading/empty/failure states, live result region, scroll to today on a phone); `resolveWeek`, `weekHeading`, `dayLabel`, `groupWeek` in `src/client/meal-plan-client.ts`; `/plan` and `/plan/:weekStart` in `src/client/App.tsx`; Plan first in `SECTIONS` and `/` → `/plan` (decision 8) | `src/shared/meal-plan.test.ts` — `plan dates` (`starts the week of %s on Monday %s`; `lists seven consecutive dates from %s to %s through clock changes`; `reads the local and UTC calendar dates separately`), `read ranges`; `test/worker/meal-plan.test.ts` — `orders entries by date, then meal, then placement`; `rejects a read with %s`; `reads a range of exactly 42 days`; `src/client/meal-plan-client.test.ts` — `weeks and dates`; `src/client/MealPlan.test.tsx` — `week view` (`shows loading, then every day and meal of an empty week`; `links to the previous, current, and next weeks`; `replaces %s with its week`; `offers to try again when the plan cannot be loaded`; `shows each kind of entry in its meal, as plain text`; `scrolling to today`); `tests/e2e/meal-plan.spec.ts` — `home is the plan, first in the navigation`; `week links are real URLs and back returns through them`; `the week fits a phone with touch-sized controls`; `on a device in Pacific/Auckland` and `on a device in America/Los_Angeles` › `today and a saved date follow the local calendar day`; `tests/e2e/visual.spec.ts` — `meal plan week`; `meal plan screens meet WCAG AA contrast, including errors and conflicts`; `every Mantine component on the plan screens has its stylesheet` | Pending          |
| `AC-03`   | `createMealPlanEntry` (guarded `INSERT … SELECT` from the household's recipes); `validateCreateMealPlanEntry`; `AddEntryDialog` (`RecipePicker`, a searchable `Select` filtered by `filterRecipes`, or a typed meal) and `AddToPlanDialog` in `src/client/MealPlanDialogs.tsx`; Add to plan in `src/client/RecipeDetail.tsx`; recipe entries link to `/recipes/:id`                                                                                                                                                                      | `test/worker/meal-plan.test.ts` — `adds a recipe entry and a free-text entry and reads them back`; `normalizes text and keeps a note on one line, storing a blank note as none`; `shows a renamed recipe under its current title`; `rejects a create with %s`; `src/shared/meal-plan.test.ts` — `create requests`; `src/client/MealPlan.test.tsx` — `adding` and `Add to plan on a recipe`; `tests/e2e/meal-plan.spec.ts` — `a member plans a recipe and a typed meal, moves one, edits a note, and removes one`; `a recipe page adds it to the plan and links to that week`; `a keyboard alone plans a meal and lands back on Add`; `tests/e2e/visual.spec.ts` — `meal plan add dialog`; `recipe detail`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Pending          |
| `AC-04`   | `updateMealPlanEntry` (version-guarded; a move resets `placed_at` and needs room in its new meal); `deleteMealPlanEntry`; `409 stale_version` with `current`; `MoveEntryDialog`, `EditEntryDialog`, `RemoveEntryDialog`, and `ConflictPanel` in `src/client/MealPlanDialogs.tsx` (only changed fields are sent; a conflict keeps the member's input and offers to apply it to the latest version); focus return in `Week`'s `closeDialog`                                                                                                | `test/worker/meal-plan.test.ts` — `moves an entry to another date and meal and places it last there`; `keeps an entry in place when only its note or text changes`; `refuses to change a recipe entry's title`; `removes an entry with its current version`; `conflicts` (`rejects a stale update with the current entry and changes nothing`; `rejects a stale remove and keeps the entry`; `reports an entry already removed by someone else as not found`; `lets exactly one of two concurrent changes from the same version win`; `lets only one of two concurrent moves take the last place in a meal`); `src/client/MealPlan.test.tsx` — `moving`, `editing`, `removing`, `closing without a change`; `tests/e2e/meal-plan.spec.ts` — `a stale change shows the other member’s version and can be applied to it`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pending          |
| `AC-05`   | `ON DELETE SET NULL` in `0004`; `deleteRecipe` batch in `src/worker/data/recipe-repository.ts` (last-title refresh guarded by household, ID, and version); `ENTRY_SELECT` joins recipes on ID and household; the removed-recipe line in `Entry` in `src/client/MealPlan.tsx`; the recipe delete dialog says planned meals keep the title                                                                                                                                                                                                 | `test/worker/meal-plan.test.ts` — `recipes` (`refuses another household's recipe exactly like a missing one`; `never returns another household's recipe through the read join`; `keeps entries under the recipe's last title after the recipe is deleted`; `changes no entry when a recipe delete is stale`; `never refreshes another household's entries when a recipe is deleted`); `test/worker/migration.test.ts` — `keeps an entry when its recipe is deleted and cascades on household delete`; `tests/e2e/meal-plan.spec.ts` — `a deleted recipe stays on the plan under its last title`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pending          |
| `AC-06`   | `migrations/0004_create_meal_plan_entries.sql`; `MEAL_PLAN_SLOT_LIMIT`, `MEAL_PLAN_HOUSEHOLD_LIMIT`, `serverPlanWriteWindow` in `src/shared/meal-plan.ts`; `src/operations/household-decommission/sql.ts` (`HOUSEHOLD_COUNTS_SQL`, `COUNT_FIELDS`, `acceptableDeletionChanges`, `EXPECTED_TABLES`) and `procedure.ts` (preflight foreign-row check); [runbook](../operations/household-decommission.md) owner summary                                                                                                                    | `test/worker/migration.test.ts` — `meal plan migration` (`applies 0004 on top of the existing schema without altering it`; `accepts only real YYYY-MM-DD dates through the date() CHECK`; `enforces slot, kind, recipe link, text bounds, and version`); `test/worker/meal-plan.test.ts` — `write window` and `limits and privacy` (`caps each meal and keeps the message free of plan text`; `refuses to move an entry into a full meal`; `caps the household and still allows moves, edits, and removal at the cap`; `writes no plan text, note, date, or recipe title to the console`); `test/worker/household-decommission.test.ts` — `counts plan entries that name a recipe once when the household delete cascades to both`; `counts an entry set to null when a recipe is deleted on its own`; `removes the pointer and household and cascades members, pantry, recipe, and plan rows`; `test/operations/decommission-procedure.test.ts` — meal-plan cases of `stops on %s with D1 untouched`, `rejects a batch that reports %s`, and `fails when verification finds %s`                                                                                                                                                                                                                     | Pending          |
| `AC-07`   | Test suites above; feature release record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `./scripts/verify.sh` in the Dev Container; PR CI and Sonar for each pull request. Pending: `V-DEV-P1`; `V-PROD-P1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pending          |

## Rollout and rollback

1. Record the owner's decisions and acceptance in the issue, and set this
   document to `Accepted` on `main`, before any feature code or migration is
   written. The decisions and acceptance were recorded on 2026-09-24, and
   the `Accepted` status reached `main` when PR #50 merged.
2. Implement on focused `codex/` branches, with the migration, decommission
   inventory, and tests together. Run the full Dev Container gate, and
   require CI, Sonar, and a security review.
3. Merge to `main`, then deploy development, which applies `0004` to
   development D1. Validate on real phones (`V-DEV-P1`). Development's
   household was bootstrapped again on 2026-09-24, and validation uses it.
4. Get the owner's separate, explicit production approval on issue #49 before
   the deploy applies `0004` to production. Record the run, Worker version,
   and the owner's checks (`V-PROD-P1`).

The migration is additive. A code rollback redeploys the previous Worker
(currently `1f62f593-28e1-433b-8acc-abdebe0b08a6`), keeping the unused table.
It neither reverses the migration nor deletes plan data. A previous Worker
that does not know the table would make the decommission preflight refuse it,
so an operator rehearsal after a rollback needs the current code. Recovery
from a bad write is a forward fix, or an explicitly approved Time Travel
restore after examining its scope.

## Resolved design decisions

The product owner answered these on 2026-09-24 in the design session. Each
chose the recommended option except decision 6.

1. **Time model and week start:** local calendar dates shown by week, with
   weeks starting on **Monday**. Rejected: weeks starting on Sunday, and a
   rolling seven days from today.
2. **Meal slots:** **Breakfast, Lunch, Dinner**, fixed. Rejected: adding a
   Snack slot, and no slots.
3. **Entry contents:** a household recipe **or** free text, each with an
   optional 200-character note, up to **6 per slot**. Rejected: one entry per
   slot, and recipes only.
4. **When a planned recipe is deleted:** keep the entry under the recipe's
   last title, marked as no longer in the library. Rejected: refusing to
   delete a planned recipe, and removing its entries.
5. **Who may edit the plan:** every active member. Rejected: owners only.
6. **History:** **keep entries until someone removes them**, bounded by the
   4,000-entry household limit. The owner chose this over the recommended
   12-month retention with deletion on the next write. Also rejected: keeping
   8 weeks. The write window of 8 weeks back to 52 weeks ahead stays as a
   separate, reversible guard against mistyped dates.
7. **Pantry and shopping:** no interaction in Phase 4. Rejected: a manual
   "add to shopping" button on ingredient lines.
8. **Landing page:** this week's plan becomes the home page, and the
   navigation order is Plan, Pantry, Recipes, Family. Rejected: keeping the
   pantry as the home page.

## Decision and change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Reason                                                                                                                                                                                                | Evidence                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 2026-09-24 | Initial design proposal; status `Designing`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Start Phase 4 with reviewable scope and explicit open decisions after the Phase 3 release                                                                                                             | [Issue #49](https://github.com/wpliao/meal-planner/issues/49)                        |
| 2026-09-24 | Resolve the eight open decisions; retention becomes keep-until-removed, bounded by the 4,000-entry household limit, with no time-based deletion; `AC-06` and `AC-07` wording follows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The owner's answers in the design session: the recommended option for decisions 1–5, 7, and 8, and "keep until deleted" for decision 6. The count limit is the retention bound on stored plan history | [PR #50](https://github.com/wpliao/meal-planner/pull/50)                             |
| 2026-09-24 | Accept design; status `Accepted`; `AC-01`–`AC-07` stable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Product owner: "I accept the design"                                                                                                                                                                  | [Approval](https://github.com/wpliao/meal-planner/issues/49#issuecomment-5806668289) |
| 2026-09-24 | Begin implementation (status `Implementing`): migration `0004`, shared contracts, the `/api/meal-plan` routes, the recipe-delete batch, and the decommission inventory. Corrections found by tests: the date `CHECK` uses `IS`, because `date()` returns `NULL` for malformed text and a `NULL` `CHECK` passes; a `recipe_id` index is added for `ON DELETE SET NULL`; the combined household cascade counts each entry once (measured). Owner answers to details the design left open: a same-day move of an entry outside the write window is allowed; notes are one line. Reversible defaults awaiting owner review: the write window of 8 weeks back to 52 weeks ahead (as designed); the recipe-delete title refresh leaves entry versions unchanged; the read rejects unknown query parameters; `limit_reached` is `409`, as designed, unlike the recipe cap's `400`                                                                                                                                                                                                                           | Implementation PR 1 of 2; the migration test was required to prove the `date()` check, and the decommission count had to be measured before it was accepted                                           | [#51](https://github.com/wpliao/meal-planner/pull/51)                                |
| 2026-09-24 | Add the week view at `/plan` and `/plan/:weekStart`, the add, move, edit, and remove dialogs, and Add to plan on a recipe's page. The plan is home and first in the navigation (decision 8). Reversible UI defaults awaiting owner review: the add dialog opens on Pick a recipe, with recipes sorted by title; results are announced in a polite live region that does not take focus, and focus returns to the control the member used, or to the meal's Add button when the entry left it; the current week scrolls to today only below a 40em viewport; This week links to `/plan/<Monday>`; after a conflict, Keep closes the dialog and reloads the week; Add to plan confirms inside its dialog with a link to that week; Edit recipe becomes a secondary button beside the primary Add to plan. Cross-feature changes: the touch-target floor now covers date, search, and select controls; `Combobox.css` joins `mantine.ts` for `NativeSelect`'s chevron; the recipe delete dialog says planned meals keep the recipe's title; the `recipe detail` baselines were regenerated and reviewed | Implementation PR 2 of 2. The phone test found Mantine text fields with no `type` below the 44px floor; the plan's fields set it, and the older fields are follow-up work                             | [#52](https://github.com/wpliao/meal-planner/pull/52)                                |
| 2026-09-24 | Refine the plan UI after the owner's `V-DEV-P1` review: each meal's dishes and its Add button sit in an indented block with a left rule under the meal label; the meal label is larger and bolder than its dishes (dish titles `sm`, notes and the removed-recipe line `xs`); the recipe picker is one searchable `Select` whose dropdown shows only matching titles in a fixed height, replacing a radio list of the whole library. The recipe field sets `type="text"` so the touch-target floor applies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | The owner: the meal label and its dishes shared one indentation and the dish text was larger than the label, which was confusing; a list of every recipe would grow very long                         | [#53](https://github.com/wpliao/meal-planner/pull/53)                                |

## Release record

- Development validation: `V-DEV-P1` functional checks passed on 2026-09-24.
  `11d92fb` (the merge of PR #52, after #51) was deployed to development by
  [Deploy run 35960457621](https://github.com/wpliao/meal-planner/actions/runs/35960457621):
  the in-workflow `./scripts/verify.sh` passed, migration
  `0004_create_meal_plan_entries.sql` was applied to the development D1, and
  Worker version `9577dce7-569b-4cf8-87fd-80c8aca43dc6` went live. The owner
  reported on a phone with a real Access identity that every feature check
  passed (planning a recipe and a typed meal, moving, editing, removing, Add
  to plan from a recipe, week navigation and back, and a deleted recipe's
  entry), and asked for three UI changes, made in
  [#53](https://github.com/wpliao/meal-planner/pull/53). The owner re-checks
  the UI on development after that deploys; `V-DEV-P1` is complete then.
- Production release: Pending
- Known follow-up work: a bulk way to clear past weeks, before any household
  nears the 4,000-entry limit (about three and a half years at three entries a
  day). Phase 5 suggestions are expected to read plan history. The pantry and
  recipe text fields render with no `type` attribute, so the touch-target
  floor in `styles.css` misses them and they measure 42px rather than 44px;
  #49's phone test found this, and the plan's own fields set `type="text"`
  (see [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md#space-radius-size)).
