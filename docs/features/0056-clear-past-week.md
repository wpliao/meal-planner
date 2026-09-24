# Feature: Clear a past week from the meal plan

- Status: Implementing
- Phase: 4 — meal planning (follow-up to [#49](https://github.com/wpliao/meal-planner/issues/49))
- Issue: [#56](https://github.com/wpliao/meal-planner/issues/56)
- Product owner: Repository owner
- Last updated: 2026-09-24
- Pull requests: [#63 — design proposal](https://github.com/wpliao/meal-planner/pull/63); [#PRn — implementation](https://github.com/wpliao/meal-planner/pull/PRn)

## Problem and outcome

Plan entries are kept until someone removes them
([#49 decision 6](./0049-meal-planning.md#resolved-design-decisions)). The only
bound on stored history is the 4,000-entry household limit. At about three
entries a day, a household reaches it after roughly three and a half years.
From then on, adding an entry fails with `limit_reached` until old entries are
removed, and the only way to remove them today is one at a time, through each
entry's menu. Freeing a single week can take 21 confirmations; freeing a month
takes about 90.

The outcome: a member can clear a whole past week in one confirmed action, and
the plan warns the family before it is full, so a household can stay under the
limit without tedious work.

The product owner resolved all three open design decisions on 2026-09-24,
each with the recommended option; see
[Resolved design decisions](#resolved-design-decisions). The owner [accepted this
design](https://github.com/wpliao/meal-planner/pull/63#issuecomment-5816812603) on 2026-09-24. Acceptance authorizes implementation only. It does not authorize
deploying or changing production, which keep their existing approval gates.

## User scenarios

1. Given an active member on a past week that has planned meals, when they
   choose **Clear this week**, then a confirmation names the week and the
   number of planned meals it will remove. After they confirm, the week is
   empty for everyone.
2. Given a household near the 4,000-entry limit, when a member opens the plan,
   then they see how many of the 4,000 places are used and a hint to clear old
   weeks, before adding fails.
3. Given two members acting at once, when one adds to, edits, or moves into a
   week while the other clears it, then nothing is removed that the clearing
   member did not see and confirm.
4. Given the current week or a future week, when a member views it, then no
   clear action is offered, and the Worker refuses a request to clear it.
5. Given a revoked member, a non-member, or an identity without a valid Access
   assertion, when they try to clear a week, then nothing is removed and no
   household data is disclosed.

## Scope

- Included: a **Clear this week** action on past weeks that have entries; its
  confirmation and conflict handling; one household-scoped Worker route that
  removes a week's entries in one D1 statement; household usage (entry count,
  limit, and oldest planned date) in the week read; a near-limit hint in the
  week view; and a clearer message when the limit is reached.
- Not included: time-based automatic deletion (rejected by #49 decision 6;
  changing that is a separate owner decision); undo, or an archive of cleared
  entries; clearing the current or a future week; clearing a range of weeks or
  everything before a date (see [resolved decision R1](#resolved-design-decisions));
  selecting individual entries to clear; exporting the plan; and any change to
  the write window, which [#59](https://github.com/wpliao/meal-planner/issues/59)
  covers.

## Acceptance criteria

These stable identifiers mirror
[issue #56](https://github.com/wpliao/meal-planner/issues/56). `AC-03` was
reworded before acceptance to state the rule that
[decision 1](#resolved-design-decisions) chose; its original wording is kept
in the decision log.

- [ ] `AC-01`: An active member can remove every entry of one past week in one
      confirmed action. Non-members and revoked members cannot.
- [ ] `AC-02`: The confirmation states the week and the number of entries. The
      removal is one D1 batch, scoped to the member's household.
- [ ] `AC-03`: Entries added or changed after the member loaded the week are
      never removed silently. If the week no longer holds exactly the entries,
      at exactly the versions, that the member confirmed, nothing is removed,
      and the member sees the new count and can confirm again.
- [ ] `AC-04`: The plan tells the member how close the household is to the
      4,000-entry limit before adding fails.
- [ ] `AC-05`: Worker-runtime, client, and Playwright tests cover
      authorization, the conflict rule, and the confirmation.

## Experience design

The design adds to the #49 week view at `/plan/:weekStart` and changes nothing
else in it.

**Which weeks can be cleared.** A week can be cleared once it has ended: its
Sunday is before the device's local today, as "today" is already computed for
the plan. On a Monday, last week can be cleared. The current week and future
weeks never show the action ([R2](#resolved-design-decisions)). A past week
with no entries does not show it either. There is no lower bound: a week from
three years ago can be cleared even though the write window no longer lets
anyone plan into it ([R6](#resolved-design-decisions)).

**The action.** On a past week with entries, a **Clear this week** button sits
on its own row under the week navigation, aligned to the end, in the
destructive `clay` style from [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md#colour),
with a 44px target. Its accessible name includes the week, for example "Clear
this week, 21–27 September 2026".

**Confirmation.** The button opens a focus-trapped dialog:

- Title: "Clear 21–27 September 2026?"
- Body: "This removes all 14 planned meals in this week for everyone. It cannot
  be undone." The number is the count of entries on screen, which is exactly
  the set the request names.
- Buttons: **Clear week** (destructive) and **Cancel**.

Cancel, Escape, or a click outside closes it and returns focus to **Clear this
week**. While the request is in flight, the dialog cannot be dismissed and its
buttons are disabled, as in the #49 remove dialog.

**After clearing.** The dialog closes, the week reloads and shows its empty
state, and the live result region announces "Cleared 14 planned meals from
21–27 September 2026." The Clear button no longer exists, so focus moves to
the week heading, which takes focus programmatically (`tabIndex={-1}`).

**When the week changed.** By
[decision 1](#resolved-design-decisions), nothing is removed; the dialog stays open and says "This week changed after you opened
it, so nothing was removed. It now has 15 planned meals." It offers **Clear
all 15** and **Keep them**, following the #49 conflict panel. The week behind
the dialog reloads. **Keep them** closes the dialog and returns focus to
**Clear this week**. If the week is now empty, the dialog closes and the
result region says "This week had already been cleared."

**Near-limit hint.** Every week view reads the household's usage. When the
household holds at least the hint threshold of entries
(3,600, 90% of the limit, by [decision 2](#resolved-design-decisions)), an alert sits above the days on every week:

- Below the limit: "The plan holds 3,650 of 4,000 planned meals. Clear old
  weeks to make room for new plans."
- At the limit: "The plan is full: 4,000 of 4,000 planned meals. Clear old
  weeks before adding more."

By [decision 3](#resolved-design-decisions), the alert ends with a link, **Go to the oldest planned week**, to the week that
holds the household's earliest entry. Clearing from the oldest week forward is
then one tap to reach each week and **Next week** to the following one.

The `limit_reached` message for a full household changes from "Remove old
entries before adding more." to "Clear old weeks before adding more." The
slot-limit message is unchanged.

Validation and failures follow the existing plan patterns: a failed request
keeps the dialog open with the error inside it, and an unreachable Worker shows
"The week could not be cleared. Check your connection and try again."

## Technical design

### Boundaries and contracts

The Worker reuses the verified identity and active-membership boundary from
[ADR 0004](../DECISIONS/0004-access-identity-and-household-authorization.md) on
every request. Household scope comes from `MemberContext`, never from the URL
or body. Every active member may clear, as every active member may remove an
entry ([#49 decision 5](./0049-meal-planning.md#resolved-design-decisions)).

New route:

- `DELETE /api/meal-plan/weeks/:weekStart` with the body
  `{ "entries": [{ "id": "<uuid>", "version": 3 }, …] }`: the entries the
  member saw in that week, each with the version they saw.
  - `204` when the week was cleared.
  - `409 week_changed` with `{ current: MealPlanEntry[] }`, the week's latest
    entries, when the week no longer matches (see
    [Conflicts](#conflicts-ac-03)). An empty `current` means the week is
    already empty.
  - `400 invalid_request` for a malformed request, a date that is not a
    Monday, a week that has not ended, or an invalid entry list.

The route keeps the existing same-origin and JSON content-type checks. Its body
limit is 16 KiB rather than the default 8 KiB: a full week holds at most 126
entries (7 days × 3 meals × 6), and 126 identifiers with versions come to about
7.6 KB, too close to the default.

Changed read, additive and backward compatible:

- `GET /api/meal-plan` adds
  `usage: { entries: number; limit: number; oldestDate: string | null }`. The
  count and oldest date are for the whole household, not the requested range.
  `oldestDate` serves the oldest-week link
  ([decision 3](#resolved-design-decisions)). An older client ignores the field.

Shared contracts in `src/shared/meal-plan.ts`:

- `MEAL_PLAN_WEEK_ENTRY_MAX` (126), derived from `MEAL_PLAN_SLOT_LIMIT`.
- `MEAL_PLAN_USAGE_HINT_AT`, the hint threshold.
- `isClearableWeek(weekStart, today, slackDays)`: a real Monday whose Sunday
  is before `today`, widened by `slackDays` as described in
  [Time and dates](#time-and-dates).
- `validateClearMealPlanWeek(weekStart, body, today, slackDays)`: the week
  rule above; exactly the `entries` field; 1–126 items; each item exactly `id`
  (a UUID) and `version` (a positive safe integer); no repeated ID. Unknown
  fields are rejected rather than ignored.
- `ClearMealPlanWeekRequest`, `MealPlanWeekConflictResponse`, and
  `MealPlanUsage` types.

The client adds `ClearWeekDialog` to `src/client/MealPlanDialogs.tsx`, and the
button, hint, and focus handling to `Week` in `src/client/MealPlan.tsx`. No
new external request is made.

### Time and dates

The client decides whether to offer the action from the device's local date,
like everything else in the plan. The Worker knows only the UTC date, which
differs from a family's local date by at most one day. It therefore accepts a
week whose Sunday is **on or before** the UTC date (one day of slack), so a
family ahead of UTC can clear last week early on Monday morning. The cost of
the slack is that a crafted request from a family behind UTC could clear the
current week on its Sunday evening. That removes only entries the member names
and could already remove one by one, so it is accepted, as the write window
accepts its own slack.

The write window (8 weeks back, 52 ahead) does not apply. It guards dates that
are written; a clear writes no date, and clearing old weeks beyond the window
is the purpose of the feature.

### Conflicts (`AC-03`)

The request names every entry the member saw, with its version. The Worker
removes the week's entries in **one** `DELETE` statement, which D1 runs as one
transaction, so no other write can land in the middle of it.

**The rule ([decision 1](#resolved-design-decisions): refuse and re-confirm).** The statement deletes the week's
entries only if the week holds exactly the named entries at exactly the named
versions:

- the number of the household's entries dated in that week equals the number
  of named entries, and
- the number of the household's entries in that week whose ID and version
  match a named pair (joined through `json_each` over one bound JSON
  parameter, which `recipe-repository.ts` already uses) also equals it.

Otherwise it deletes nothing, and the Worker reads the week and returns
`409 week_changed`. An entry added, edited, moved in, moved out, or removed by
someone else after the member loaded the week changes one of the counts, so
the member either removes exactly what they confirmed or removes nothing and
confirms again with the new count. A retried request after a lost response
finds the week empty and returns `409` with no entries, which the client
reports as already cleared.

**Rejected alternative (remove only what was seen).** The statement deletes the
household's entries in that week whose ID and version match a named pair, and
the Worker returns how many it removed. Changed and new entries stay, and the
client reloads and reports "Cleared 12 planned meals. 2 that someone else
changed were kept." Nothing unseen is removed, but the week the member meant
to empty may not end up empty, and the confirmed count may not be what
happened.

Either way, a named ID from another household can never match, because every
predicate includes the caller's household, and the conflict response contains
only the caller's own week.

### Data and migrations

**No migration and no new table.** The feature deletes rows from the existing
`meal_plan_entries` table through the `(household_id, plan_date)` index. The
household decommission inventory in `src/operations/household-decommission/`
is therefore unchanged. Nothing references `meal_plan_entries`, so a clear has
no cascade. Measured in the Workers runtime before the Worker relied on it: D1
reports exactly one affected row per removed entry.

The usage read adds one statement to the week read: `COUNT(*)` and
`MIN(plan_date)` over the household's entries, both served by the same index.
With at most 4,000 rows per household, the cost stays small and predictable.

Retention is unchanged: entries are kept until removed, and the 4,000-entry
limit remains the bound on stored history. Cleared entries are deleted with no
tombstone, archive, or undo. As with single removals, D1 Time Travel still
holds the removed rows for its window (7 days on the current Workers Free
plan). The #49 document's
[Retention](./0049-meal-planning.md#data-and-migrations) paragraph and its
known follow-up work link here, and the Phase 4 section of
[DATA_MODEL.md](../DATA_MODEL.md#phase-4-meal-plan-model) describes the clear.

### Security and privacy

This is a destructive bulk delete of family data. The controls:

- Every statement is scoped to the verified member's household; the week and
  entry identifiers only narrow within it.
- A confirmation that names the week and count precedes the request, and the
  conflict rule prevents removing anything the member did not see.
- The request is bounded: one week, at most 126 identifiers, a 16 KiB body.
  One statement touches at most 126 rows.
- Every field is validated at the API boundary; unknown fields, repeated IDs,
  non-Mondays, and weeks that have not ended are refused.
- The existing same-origin and content-type checks block cross-site requests.
- No plan text, note, date, recipe title, entry ID, or member identity appears
  in application logs or error messages. Error messages carry no plan content.
- Revoked members, non-members, and requests without a valid Access assertion
  are refused before any plan statement runs, exactly as on the other plan
  routes.
- The feature sends nothing to a third party.

An active member can already remove every entry one at a time, so the route
grants no new power; it makes an existing power faster. Recovery from a
mistaken clear is an explicitly approved D1 Time Travel restore within 7 days,
after examining its scope, as for any other mistaken removal.

### Accessibility

The Clear button has a specific accessible name that includes the week. The
dialog traps focus, is labelled by its title, and returns focus to the button
on cancel or **Keep them**. After a clear, focus moves to the week heading and
the result is announced through the existing polite live region. The hint is
static text in reading order before the days, not a live region, so it is not
re-announced on every load; its link has a specific name. Contrast and visual
snapshots are checked on Chromium and WebKit at desktop and phone sizes.

### Reliability and observability

The clear is one statement and so one transaction. A lost response is safe to
retry (see [Conflicts](#conflicts-ac-03)). A failed request keeps the dialog
open with an error. The usage read failing fails the week read, as any other
read failure does, with **Try again**. Outcome counts may be recorded without
plan content.

## Test strategy

- Shared unit tests (`src/shared/meal-plan.test.ts`): `isClearableWeek` on a
  Monday, a mid-week date, the current week, last week on its following Monday,
  a future week, with and without one day of slack, and across month and year
  boundaries; `validateClearMealPlanWeek` for missing, extra, and malformed
  fields, 0 and 127 entries, repeated IDs, bad UUIDs, and bad versions.
- Workers-runtime tests (`test/worker/meal-plan.test.ts`):
  - a member clears a past week, and only that week's entries of that
    household are removed
  - a week older than the write window can be cleared
  - the current week, a future week, and a non-Monday are refused
  - revoked members, non-members, and requests without a valid Access
    assertion change nothing; the same-origin and content-type checks apply
  - another household's IDs in the request neither match nor are disclosed
  - the conflict rule after an add, an edit, a move in, a move out, and a
    removal by someone else, and after a repeated request
  - the D1 affected-row count equals the number of removed entries
  - `usage` counts the whole household, reports the oldest date, and never
    counts another household's entries
  - the full-household message, and no plan content in logs
  - the body limit
- Client unit tests (`src/client/MealPlan.test.tsx`): the button appears only
  on past weeks with entries; the dialog states the week and count; success
  announces and moves focus; cancel returns focus; the conflict panel, and the
  already-cleared notice; the hint below, at, and above the threshold and at
  the limit; and the oldest-week link. A plain Vitest test covers each UI
  branch, because Sonar's new-code coverage counts only Vitest.
- Playwright on Chromium and WebKit, desktop and phone
  (`tests/e2e/meal-plan.spec.ts`), each test using its own past week inside
  the write window so it can seed entries through the API:
  - clear a past week and see it empty
  - no clear action on the current or a future week
  - a stale clear from a second page shows the new count and can clear it
  - a keyboard-only clear with focus checks
  - phone layout and touch targets, and visual snapshots of the button and the
    dialog
  - a visual snapshot of the near-limit hint, with the read response's `usage`
    replaced through `page.route`. Filling the per-project household to 3,600
    real entries would break the other specs, which share it and run in
    parallel.
- Development validation on a real phone with a real Access identity, recorded
  separately from automated results.

## Traceability

Implementation is one pull request
([#PRn](https://github.com/wpliao/meal-planner/pull/PRn)): the shared contract,
Worker route, usage read, client dialog and hint, and tests together, with no
migration. Test names are given as `file` › `describe` › `test`.

| Criterion | Implementation                                                                                                                                                                                                                                                                                                                                                | Automated tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Release evidence |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `AC-01`   | `handleMealPlanWeek` and `MEAL_PLAN_WEEK_PATH` in `src/worker/index.ts` (a verified active member on every request; household from `MemberContext`); `isClearableWeek` and `validateClearMealPlanWeek` in `src/shared/meal-plan.ts`; the Clear this week button in `Week` in `src/client/MealPlan.tsx`, shown only on an ended week with entries              | `test/worker/meal-plan.test.ts` › `clearing a week` › `removes every entry of an ended week and nothing outside it`, `clears a week from before the write window`, `refuses to clear %s`, `accepts a week whose Sunday is the UTC date, a day of slack for families ahead of UTC`, `lets a regular member clear a week`; `authorization and household isolation` › `denies a revoked member every plan route`, `denies an identity that belongs to no household`, `denies a request without a valid Access assertion`, `never clears another household's entries in the same week`; `validation` › `requires same-origin JSON for every plan mutation`, `answers unknown methods, malformed IDs, and unknown plan paths with 404`; `src/shared/meal-plan.test.ts` › `clearing a week` › `%s: %s on %s (slack %i) is %s`; `src/client/MealPlan.test.tsx` › `clearing a week` › `is offered only on a past week that has planned meals`; `tests/e2e/meal-plan.spec.ts` › `a member clears a past week, and only a past week offers it`, `a keyboard alone clears a past week`   | Pending          |
| `AC-02`   | `ClearWeekDialog` in `src/client/MealPlanDialogs.tsx` (names the week and the count of entries on screen, and sends exactly those); `clearMealPlanWeek` in `src/worker/data/meal-plan-repository.ts` (one `DELETE` statement, every predicate scoped to the household); `MEAL_PLAN_WEEK_ENTRY_MAX`; `MEAL_PLAN_CLEAR_MAX_JSON_BYTES` in `src/worker/index.ts` | `test/worker/meal-plan.test.ts` › `clearing a week` › `reports one affected row per removed entry`, `clears a full week of 126 entries within the body limit`, `refuses a body over 16 KiB without reading the week`, `rejects a clear with %s`, `rejects an entry named twice, in any letter case`, `matches an entry named in upper case`; `src/shared/meal-plan.test.ts` › `clearing a week` › `accepts distinct entries and lower-cases their IDs`, `accepts a full week of entries`, `rejects %s before reading the body`, `rejects %s`; `src/client/MealPlan.test.tsx` › `clearing a week` › `clears after a confirmation that names the week and count, then focuses the heading`, `names a single planned meal`, `cancels without a request and returns focus to Clear`, `keeps the dialog open and explains %s`; `tests/e2e/meal-plan.spec.ts` › `a member clears a past week, and only a past week offers it`; `tests/e2e/visual.spec.ts` › `meal plan clear week and near-limit hint`, `clearing a week meets WCAG AA contrast and styles every Mantine component` | Pending          |
| `AC-03`   | The count and version guard in `clearMealPlanWeek`, and its `409 week_changed` with the week's latest entries; `week_changed` in `ApiErrorCode` in `src/shared/api.ts`; `weekConflictFrom` in `src/client/meal-plan-client.ts`; the conflict panel, **Keep them**, and the reload behind the dialog in `ClearWeekDialog`                                      | `test/worker/meal-plan.test.ts` › `the week changed after it was read` › `removes nothing when %s, and returns the latest week`, `answers a repeated clear with an empty week`, `never removes an entry added at the same moment`; `authorization and household isolation` › `treats another household's entry ID as a changed week and discloses nothing`; `src/client/MealPlan.test.tsx` › `clearing a week` › `shows the new count after the week changed, and clears that version on request`, `offers to clear a single remaining meal after a conflict`, `keeps the week when asked and returns focus to Clear`, `reports a week someone else already cleared`; `tests/e2e/meal-plan.spec.ts` › `a clear after another member changed the week shows the new count and can clear it`                                                                                                                                                                                                                                                                                    | Pending          |
| `AC-04`   | `readMealPlan` in `src/worker/data/meal-plan-repository.ts` (`usage` read in the same batch as the week); `MealPlanUsage` and `MEAL_PLAN_USAGE_HINT_AT` in `src/shared/meal-plan.ts`; `UsageHint` in `src/client/MealPlan.tsx` (from 3,600 entries, with a link to the oldest planned week); the full-household `limit_reached` message in `householdFull`    | `test/worker/meal-plan.test.ts` › `usage` › `reports an empty plan`, `counts the whole household, whatever the range, and never another household's entries`; `limits and privacy` › `caps the household and still allows moves, edits, and removal at the cap`; `src/shared/meal-plan.test.ts` › `clearing a week` › `warns from 90% of the household limit`; `src/client/MealPlan.test.tsx` › `the near-limit hint`; `tests/e2e/visual.spec.ts` › `meal plan clear week and near-limit hint`, `clearing a week meets WCAG AA contrast and styles every Mantine component`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Pending          |
| `AC-05`   | The suites above; `test/worker/meal-plan.test.ts` › `limits and privacy` › `writes no plan text, note, date, or recipe title to the console`, which now also clears and conflicts; this feature's release record                                                                                                                                              | `./scripts/verify.sh` in the Dev Container; PR CI and Sonar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Pending          |

## Rollout and rollback

1. The owner answered the three open decisions on 2026-09-24, and `AC-03` was
   reworded to the chosen rule. The owner
   [accepted the design](https://github.com/wpliao/meal-planner/pull/63#issuecomment-5816812603) on 2026-09-24,
   and the `Accepted` status reaches `main` when #63 merges, before any
   feature code is written.
2. Implement on a focused `claude/` branch. Run the full Dev Container gate,
   and require CI, Sonar, and a security review. There is no migration.
3. Merge to `main`, then deploy development. Validate on a phone (`V-DEV-P1`):
   plan a few meals into a past week inside the write window, clear it, check
   the count and the empty week, and check that the current week offers no
   clear. The hint cannot be seen on development without 3,600 entries, so it
   is covered by automated tests and a visual snapshot.
4. Get the owner's separate, explicit production approval on issue #56 before
   the production deploy. Record the run, Worker version, and the owner's
   checks (`V-PROD-P1`).

Rollback redeploys the Worker version that was live before the release. With
no migration, rollback needs no data step. Rollback does not restore cleared
entries; that needs an explicitly approved Time Travel restore within 7 days.

## Resolved design decisions

The product owner answered these on 2026-09-24 in the design session, each
with the recommended option.

1. **When the week changed after the member opened it (`AC-03`):** **refuse
   and re-confirm.** Nothing is removed; the dialog shows the new count and
   offers to clear the latest version, so what the member confirmed is exactly
   what is removed and a cleared week is always empty. Rejected: removing only
   the entries the member saw and keeping anything changed or new.
2. **When the near-limit hint appears (`AC-04`):** **from 3,600 entries
   (90%)**, about four months' warning at three entries a day, and out of
   sight for the first three years. Rejected: from 3,000 (75%); always showing
   the count on every week.
3. **Reaching old weeks:** **the hint links to the oldest planned week**, and
   **Next week** walks forward from it; the read adds `oldestDate`. Rejected:
   no link (three years back is about 150 taps of **Previous week**); a "Go to
   week" date field on every week view.

These follow from issue #56 or from #49's accepted decisions. The owner may
reopen any of them at acceptance.

- **R1 — One week at a time.** Issue #56 asks for one week (`AC-01`). A week is
  the smallest unit that clears meaningfully, its confirmation can state an
  exact count, and its conflict rule can name every entry. Clearing everything
  before a date would remove up to thousands of entries in one irreversible
  step and could not name them in one request. Trade-off: a household that
  stays at the limit must clear about one old week for each new week it plans.
  A range clear can be proposed later if that proves tedious.
- **R2 — Past weeks only.** Only a week whose Sunday is before local today can
  be cleared. The issue excludes future weeks, and the current week is not
  past. Removing current or future plans stays a per-entry action.
- **R3 — Every active member may clear**, as every active member may remove
  entries (#49 decision 5).
- **R4 — No undo, archive, or time-based deletion.** These are non-goals of
  the issue, and #49 decision 6 rejected time-based deletion.
- **R5 — No schema change.** The feature uses the existing table and index, so
  there is no migration and the decommission inventory is unchanged.
- **R6 — The write window does not apply to clearing**, because it guards
  written dates and clearing old weeks is the purpose.

## Decision and change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Reason                                                                                                                              | Evidence                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-09-24 | Initial design proposal; status `Designing`; three open decisions and six resolved from the issue. Authored by Claude Code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Follow-up to the #49 release: the 4,000-entry household limit is the only bound on plan history, and removal is one entry at a time | [Issue #56](https://github.com/wpliao/meal-planner/issues/56); [#63](https://github.com/wpliao/meal-planner/pull/63) |
| 2026-09-24 | Resolve the three open decisions with the recommended options: refuse and re-confirm on a changed week; show the hint from 3,600 entries; link the hint to the oldest planned week. `AC-03` reworded from its issue text, "Entries added or changed after the member loaded the week are not removed silently. The design decides between refusing on a conflict and removing only the entries the member saw.", to the chosen rule                                                                                                                                                                                                                                                                                                                                                                                                                         | The owner's answers in the design session                                                                                           | [#63](https://github.com/wpliao/meal-planner/pull/63)                                                                |
| 2026-09-24 | Accept design; status `Accepted`; `AC-01`–`AC-05` stable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Product owner: "I accept the design"                                                                                                | [Approval](https://github.com/wpliao/meal-planner/pull/63#issuecomment-5816812603)                                   |
| 2026-09-24 | Begin implementation (status `Implementing`) in one pull request, with no migration. Measured in the Workers runtime: D1 reports one affected row per cleared entry. Removing the version check from the guard fails the edited and moved-within-the-week conflict tests, so they prove it. Reversible defaults awaiting owner review: the Clear button is a `clay` outline button on its own row under the week navigation; the hint is a `clay` alert above the days on every week, and leaves out its link on the oldest week itself; after **Keep them** the result reads "The week was left as it is now."; an already-cleared week is reported in the error tone, like an entry someone else removed; entry IDs are matched in any letter case; the route accepts any path segment, so a wrong date is answered `400` with a reason rather than `404` | Implementation of the accepted design; each default is the smallest choice consistent with the plan's existing patterns             | [#PRn](https://github.com/wpliao/meal-planner/pull/PRn)                                                              |

## Release record

- Development validation: Pending
- Production release: Pending
- Known follow-up work: None yet
