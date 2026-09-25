# Feature: Family favourites and "Not now" for meal suggestions

- Status: Designing
- Phase: 5 — deterministic suggestions
- Issue: [#78](https://github.com/wpliao/meal-planner/issues/78)
- Product owner: Repository owner
- Last updated: 2026-09-25
- Pull requests: [#79 — design proposal](https://github.com/wpliao/meal-planner/pull/79)

## Problem and outcome

Meal suggestions ([#73](./0073-meal-suggestions.md)) rank the library by what
is in the pantry and what was planned recently. They know nothing about what
the family enjoys, and they keep offering a recipe the family has just decided
against. The member scrolls past the same unwanted suggestion every time they
open **Add**, and cannot say "we love this one".

The outcome: the household marks recipes as **family favourites**, and
suggestions give a favourite a gentle lift, with the reason "Family favourite".
On any suggestion a member can choose **Not now**: that recipe leaves the
household's suggestions for 7 days and then returns by itself. Both are shared
by the household, like the pantry and the plan. Suggestions stay deterministic
and explainable, and nothing is planned automatically.

This is the second Phase 5 feature in [PRODUCT.md](../PRODUCT.md#planned-product-phases),
and the follow-up the #73 design named. It is the first feature to store
household preferences, so it settles their retention here
([DATA_MODEL.md](../DATA_MODEL.md#durable-principles)).

The product owner settled four choices on 2026-09-25, before this design was
written. They are recorded under
[Resolved design decisions](#resolved-design-decisions). Three questions remain
open under [Open design decisions](#open-design-decisions), each with a
recommendation.

## User scenarios

1. Given a recipe the family loves, when a member opens its page and taps
   **Mark as favourite**, then every member sees it marked. When it ties with
   other recipes on pantry matches and recency, it ranks above them, and its
   suggestion says "Family favourite".
2. Given the Thursday dinner suggestions, when a member taps **Not now** on one,
   then it leaves the list and the next recipe takes its place. The dialog says
   it is hidden for 7 days and offers **Undo**.
3. Given a recipe hidden by **Not now**, when another member opens **Add** the
   next day, then it is not suggested to them either. When 7 days have passed,
   it is suggested again without anyone doing anything.
4. Given a hidden recipe, when a member opens its page, then it says "Hidden
   from suggestions until Friday 2 October" and offers **Show in suggestions**.
5. Given a recipe with a favourite or **Not now**, when the recipe is deleted
   or the household is decommissioned, then its preferences are deleted with
   it.
6. Given a revoked member, a non-member, or another household's recipe ID,
   when a preference is read or changed, then nothing is changed or disclosed.

## Scope

- Included: a household-scoped preference per recipe (favourite, and a **Not
  now** end time); a toggle on the recipe page; **Not now** and **Undo** in the
  add dialog's suggestions; the recipe page's hidden notice with **Show in
  suggestions**; the favourite key and reason in the #73 ranking; a migration,
  with the new table in the household decommission inventory.
- Not included: per-member preferences; avoided ingredients or dietary
  exclusions; a "dislike" or "never suggest" state; ratings or notes on how a
  meal went; learning from what was planned; filtering or sorting the library
  by favourite; showing favourites on the plan; any AI or external service; any
  change to pantry matching.

## Acceptance criteria

These stable identifiers mirror [issue #78](https://github.com/wpliao/meal-planner/issues/78).

- [ ] `AC-01`: An active member can mark and unmark a recipe as a family
      favourite from the recipe's page. The state is shared by every member of
      the household.
- [ ] `AC-02`: Suggestions rank with a favourite key after recency: held
      pantry matches, then not planned within 14 days, then favourite, then
      least recently planned, then title and ID. A favourite's suggestion
      shows "Family favourite". All #73 criteria still hold.
- [ ] `AC-03`: **Not now** on a suggestion hides that recipe from the
      household's suggestions for 7 days. It can be undone immediately, and
      shown again from the recipe's page before the 7 days end. After 7 days
      the recipe returns without any action.
- [ ] `AC-04`: Preferences are household-scoped. Non-members and revoked
      members can neither read nor change them, and another household's recipe
      IDs are refused without disclosing anything. Setting a preference does
      not change the recipe's content or version.
- [ ] `AC-05`: Retention and deletion: deleting a recipe deletes its
      preferences. Expired **Not now** state is never applied and is removed.
      Household decommission removes every preference row. No record of which
      member set a preference is kept.
- [ ] `AC-06`: Unit tests cover the ranking with favourites and **Not now**
      expiry. Workers-runtime tests cover authorization, household isolation,
      retention, and the recipe-delete cascade. Playwright covers marking a
      favourite and **Not now** with undo on a phone viewport.

## Experience design

**Recipe page.** A toggle button joins **Add to plan**, **Edit recipe**, and
**Delete recipe**. It reads **Mark as favourite** when off, and **Favourite**
with a filled star when on. It is a native button with `aria-pressed`. Tapping
it saves at once; while saving, the button is disabled, and a failure shows
the existing alert style with the state unchanged. When the recipe is hidden
by **Not now**, a line under the title reads "Hidden from suggestions until
Friday 2 October", in the device's own calendar, with a **Show in
suggestions** button.

**Suggestions** ([#73](./0073-meal-suggestions.md#experience-design)):

- A favourite's reasons start with "Family favourite". It joins the first
  reason line, "Family favourite · Uses what you have: chicken, rice (low)",
  or stands alone on it when there is no pantry reason. The planning reason
  stays on its own line, so the #73 layout keeps its two lines.
- Each option gains a **Not now** button beside its card, outside the radio's
  label, so a tap on it never chooses the recipe. Its accessible name is "Not
  now: Miso soup". It is a subtle button with a 44px touch target.
- After **Not now**, the dialog reloads the suggestions. The hidden recipe is
  gone, and the next one fills the list. A polite `output` above the group
  reads "“Miso soup” is hidden from suggestions for 7 days." with **Undo**.
  **Undo** restores it and reloads the suggestions. If the hidden recipe was
  the one chosen, the choice is cleared, and the **Recipe** field is emptied.
- **Not now** never removes the recipe from the **Recipe** search, which still
  lists the whole library, so a hidden recipe can still be planned.
- A failed **Not now** or **Undo** shows "That could not be saved. Try again."
  in the same `output`. The suggestions and the choice stay as they were.

States not listed here are unchanged from #73.

## Ranking (`AC-02`, `AC-03`)

The #73 function `rankMealSuggestions` gains two inputs: each recipe's
preference and the current instant. Everything else is unchanged.

1. **Hidden recipes are left out** before ranking: a recipe whose **Not now**
   end time is after the current instant is not a candidate. An end time at or
   before the current instant has no effect.
2. Recipes are sorted by these keys, each breaking ties in the one before:
   1. held pantry matches, more first (unchanged);
   2. not planned within 14 days either side of the meal's date first
      (unchanged);
   3. **favourites first** (new);
   4. least recently planned, never first (unchanged);
   5. title by code point, then recipe ID (unchanged).

A favourite planned yesterday therefore stays below a recipe that was not,
but a favourite beats an equally placed recipe that was planned less
recently. The response adds `favourite: boolean` to each suggestion. A **Not
now** end time is never returned by the suggestions route.

## Technical design

### Boundaries and contracts

The Worker reuses the verified identity and active-membership boundary from
[ADR 0004](../DECISIONS/0004-access-identity-and-household-authorization.md).
Household scope comes from `MemberContext`, never from the URL or body.

New route:

- `PUT /api/recipes/{id}/preferences`, with the body
  `{ "favourite": boolean }` or `{ "notNow": boolean }`. Exactly one field is
  allowed.
  - `favourite: true` or `false` sets or clears the favourite.
  - `notNow: true` sets the end time to 7 days after the Worker's current
    instant, which also restarts an existing one. `notNow: false` clears it.
  - `200` with `{ preferences: RecipePreferences }`. The request is idempotent:
    repeating it gives the same state, apart from the restarted 7 days.
  - `400 invalid_request` for a malformed body or an unknown field; `404
not_found` for a missing recipe or one of another household, answered
    alike; the existing `401`/`403` answers before any household statement.
    Same-origin and JSON headers are required, as for every mutation.
  - Concurrent changes are last-write-wins, without a version. A preference
    is a single switch, not content, so a conflict screen would ask the member
    to choose between two taps.

Changed routes:

- `GET /api/recipes/{id}` returns `{ recipe, preferences }`. `Recipe` and its
  `version` are unchanged, and a preference change never bumps them.
- `GET /api/meal-plan/suggestions` adds `favourite` to each suggestion and
  leaves out hidden recipes. Its batch gains one statement.

Shared contract, in `src/shared/recipe-preferences.ts`:

```ts
interface RecipePreferences {
  favourite: boolean;
  // ISO instant when "Not now" ends, or null. Always in the future when set.
  notNowUntil: string | null;
}
```

- `RECIPE_NOT_NOW_DAYS` (7), `validateRecipePreferenceChange(body)`, and
  `notNowActive(until, now)`.

### Data and migrations

**Migration `0005_create_recipe_preferences.sql`** adds one table:

```sql
CREATE TABLE recipe_preferences (
  recipe_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  favourite INTEGER NOT NULL CHECK (favourite IN (0, 1)),
  not_now_until TEXT
    CHECK (not_now_until IS NULL
      OR not_now_until IS strftime('%Y-%m-%dT%H:%M:%fZ', not_now_until)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  -- A row exists only while it holds a preference.
  CHECK (favourite = 1 OR not_now_until IS NOT NULL)
) STRICT;

CREATE INDEX recipe_preferences_household_idx
  ON recipe_preferences (household_id);
```

- The time check uses `IS`, because a SQLite CHECK that evaluates to NULL
  passes (a lesson from #49).
- There is at most one row per recipe, so at most 500 per household.
- Every write selects the recipe by both ID and household, so a row can only
  name a recipe of its own household. A composite foreign key would need a
  new unique index on `recipes`, and is not added.
- A write that leaves neither preference deletes the row. The same batch also
  deletes the household's rows that hold only an expired **Not now**. So
  expired state is ignored on every read, and removed on the household's next
  preference write, when the recipe is deleted, or when the household is
  decommissioned. No member identity is stored.
- **Decommission inventory:** `recipe_preferences` joins
  `src/operations/household-decommission/` (`sql.ts`, `procedure.ts`, and
  `docs/operations/household-decommission.md`) in the same pull request as the
  migration. D1's affected-row count for a cascaded delete is measured in the
  Workers runtime before the procedure relies on it.
- **Rollout order:** the migration applies before the Worker that reads the
  table, as the Deploy workflow already does. The old Worker never reads the
  table, so the migration is safe to apply first. Rolling the Worker back
  leaves the table unread. Rolling the migration back is not supported, and a
  forward migration would drop the table if the feature were retired.

### Cost on Workers Free

The suggestions batch reads at most 500 more rows, and ranking adds one
lookup per recipe. In production on 2026-09-25, the #73 suggestion requests
mostly used under 5 ms of CPU, with outliers of 10 ms and 14 ms (owner, on
[#73](https://github.com/wpliao/meal-planner/issues/73#issuecomment-5832491525)).
This feature adds nothing measurable to that. A preference write is two short
statements.

### Security and privacy

- Every statement is scoped to the verified member's household, and a foreign
  recipe ID is answered exactly like a missing one.
- The body is validated with a fixed shape. Unknown fields and other types are
  refused, and nothing from the body reaches SQL except bound booleans.
- A preference is not sensitive on its own: it says the household likes a
  recipe, or skipped it for a week. No member identity is recorded. No
  preference, title, or time is logged.
- No AI, external service, secret, or binding is added.

### Accessibility

The favourite button uses `aria-pressed` and keeps its accessible name "Mark
as favourite" in both states. Its visible text and star change. Each **Not
now** button is named for its recipe. After **Not now**, focus moves to
**Undo**; after **Undo**, focus returns to the restored recipe's radio. The
status line is a polite `output`. Touch targets are at least 44px, and the
visual and contrast checks cover the new states on Chromium and WebKit, at
desktop and phone sizes.

### Reliability and observability

A preference write is idempotent and safe to retry. A failure leaves the
screen's state as it was and says so. The suggestions route still fails on its
own, as in #73. Development validation checks the preference writes and the
suggestion requests in Workers observability, with no household content
logged.

## Test strategy

- Shared unit tests: the ranking's favourite key between recency and last
  planned, with its ties; hidden recipes left out before the limit of 5; an
  end time equal to the current instant has no effect; the body validation.
- Workers-runtime tests (`test/worker/recipe-preferences.test.ts`):
  - set and clear each preference, and repeat a request;
  - the 7-day end time from the Worker's clock, and a restart;
  - the row is deleted when it holds neither preference, and expired rows are
    pruned on the next write;
  - a recipe's version and content are unchanged by a preference;
  - deleting a recipe deletes its row (cascade, with D1's affected-row count
    measured);
  - revoked members, non-members, requests without a valid Access assertion,
    and another household's recipe IDs are refused before any household
    statement, and disclose nothing;
  - suggestions leave out hidden recipes and flag favourites;
  - no title or preference in the console.
- The migration test covers `0005` and its CHECK constraints, including the
  NULL case. The household decommission tests cover the new table.
- Client tests: the favourite toggle, its pending and failure states; the
  hidden notice and **Show in suggestions**; **Not now**, **Undo**, and focus
  in the add dialog; the cleared choice when the hidden recipe was chosen;
  the "Family favourite" wording.
- Playwright on Chromium and WebKit, desktop and phone: mark a favourite and
  see its suggestion's reason; **Not now** and **Undo**; the recipe page's
  hidden notice; a keyboard-only pass; visual snapshots reviewed before
  commit.
- Development validation on a phone, with the family's real data.

## Traceability

Implementation is expected in one pull request: the migration and inventory,
the shared contract, the Worker routes, the ranking change, the recipe page,
the dialog, and the tests.

| Criterion | Implementation | Automated tests | Release evidence |
| --------- | -------------- | --------------- | ---------------- |
| `AC-01`   | Pending        | Pending         | Pending          |
| `AC-02`   | Pending        | Pending         | Pending          |
| `AC-03`   | Pending        | Pending         | Pending          |
| `AC-04`   | Pending        | Pending         | Pending          |
| `AC-05`   | Pending        | Pending         | Pending          |
| `AC-06`   | Pending        | Pending         | Pending          |

## Rollout and rollback

1. The owner answers the open decisions and accepts the design. Its status
   becomes `Accepted` on `main` before any feature code is written.
2. Implement on a focused `claude/` branch, with the migration and the
   decommission inventory in the same pull request. Run the full Dev Container
   gate, and require CI, Sonar, and a security review.
3. Merge to `main`, then deploy development, which applies `0005` before the
   Worker. Validate on a phone (`V-DEV-F1`): mark a favourite and see its
   reason; use **Not now** and **Undo**; see the hidden notice on the recipe
   page and show it again; check that a second member sees the same state.
4. Get the owner's separate, explicit production approval on issue #78 before
   the production deploy, which applies `0005` to production D1. Record the
   run, the Worker version, the migration, and the owner's checks
   (`V-PROD-F1`).

Rollback redeploys the Worker version that was live before the release. The
table stays and is unused. Preferences set after the release are kept, and
are applied again if the release is redeployed.

## Open design decisions

1. **Where preferences are stored.** Recommended: **a separate
   `recipe_preferences` table**, as above. A preference is household state
   about a recipe, not recipe content: it has its own retention (**Not now**
   expires), must not bump the recipe's version, and must not be caught by
   the recipe edit conflict check. Alternative: two columns on `recipes`,
   updated without touching `version`. That needs no inventory change, but
   mixes content and state in one row, and every recipe write path would have
   to preserve them.
2. **When "7 days" ends.** Recommended: **exactly 7 × 24 hours after the
   tap**, from the Worker's clock. It needs no time zone and is the same for
   every member, and the recipe page shows the end in the device's own
   calendar. Alternative: the end of the 7th day in the family's time zone,
   which reads more naturally ("until Friday"), but the Worker would need the
   device's time zone.
3. **Where a favourite shows.** Recommended: **the recipe page and the
   suggestions only**. Alternative: also a star in the recipe library list,
   which makes favourites visible at a glance but widens the change to
   another screen and its visual snapshots, and invites the library filter
   this slice leaves out.

## Resolved design decisions

The owner chose these on 2026-09-25, before the design, each with the
recommended option.

- **F1 — Signals:** family favourites and **Not now** only. Rejected: also
  avoided ingredients, which are sensitive (health or religion) and need their
  own retention design; also "dislike", when a recipe can be deleted instead.
- **F2 — Scope:** the household's preferences, shared by every member like
  the pantry and the plan. Rejected: per-member preferences, which store
  per-person data, need clean-up when a member is removed, and leave open
  whose preferences rank a shared meal.
- **F3 — Not now:** hides a recipe for 7 days, then it returns by itself.
  Rejected: 14 days, matching the recency window; until the next week.
- **F4 — Ranking:** the favourite key comes after pantry matches and recency,
  before least recently planned. Rejected: favourites first, above the
  pantry; favourites after the pantry, before recency.

## Decision and change log

| Date       | Change                                                                                                                                      | Reason                                                                                              | Evidence                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-09-25 | Initial design proposal; status `Designing`; four decisions resolved by the owner before the design and three open. Authored by Claude Code | Second Phase 5 feature, and the follow-up the #73 design named. The owner chose F1–F4 on 2026-09-25 | [Issue #78](https://github.com/wpliao/meal-planner/issues/78); [#79](https://github.com/wpliao/meal-planner/pull/79) |

## Release record

- Development validation: Pending
- Production release: Pending
- Known follow-up work: avoided ingredients or dietary exclusions, with their
  own retention design, as a possible later feature.
