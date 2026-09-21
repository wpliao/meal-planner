# Feature: Lightweight household pantry

- Status: Implementing
- Phase: 2
- Issue: [#16](https://github.com/wpliao/meal-planner/issues/16)
- Product owner: Repository owner
- Last updated: 2026-09-21
- Pull requests: [#17 — design proposal](https://github.com/wpliao/meal-planner/pull/17); [#18 — implementation](https://github.com/wpliao/meal-planner/pull/18)

## Problem and outcome

Remembering exact ingredient counts and every use is too much work for a family.
The pantry should instead answer two practical questions quickly: “Do we likely
have this?” and “What should we buy?” An active family member can record a named
food item as **Available**, **Low**, or **Needed**. Low and Needed form a shopping
view; buying an item and marking it Available removes it from that view. Signals
are manually maintained and are not claims of exact stock.

This is one focused Phase 2 feature. The existing Phase 1 identity and household
authorization boundary remains authoritative. Recipe import, meal planning,
nutrition, photos, and automatic suggestions belong to later phases.

## User scenarios

1. Given an active family member, when they add “rice” as Available, then every
   active member of that household sees rice without entering a quantity.
2. Given an item running low, when a member marks it Low, then it appears in the
   shopping view; marking it Available after buying it removes it from that view.
3. Given an item not on hand, when a member marks it Needed, then it appears in
   the shopping view ahead of Low items.
4. Given a typo or irrelevant item, when a member renames or deletes it, then
   the household list updates without duplicate names or silent stale edits.
5. Given a revoked or unregistered identity, when they request pantry data, then
   the application returns no household information.

## Scope

- Included: shared household item list; manual add, rename, state change, and
  deletion; Available/Low/Needed signals; a derived shopping view; last-change
  timestamp; responsive, keyboard-accessible states; D1 persistence and tests.
- Not included: quantities, units, use-by dates, storage location, purchase
  history, automatic consumption deduction, barcode/photo input, external
  services, recipe matching, meal plans, nutrition, or AI.
- An item not currently relevant may be deleted. An Available item is a human
  signal, not a guarantee that enough exists for a particular recipe.

## Acceptance criteria

Identifiers match [issue #16](https://github.com/wpliao/meal-planner/issues/16)
and stay stable after design acceptance. Changed criteria must be retained as
superseded and explained in the decision log.

- [ ] `AC-01`: Active household members can view only their household's pantry
      items, with each item's name, availability signal, and last-change time;
      non-members cannot read them.
- [ ] `AC-02`: Active members can add an item using a short name and one of three
      explicit signals: Available, Low, or Needed. No quantity is required.
- [ ] `AC-03`: Active members can change an item's signal; a shopping view shows
      Low and Needed items and no longer shows an item once marked Available.
- [ ] `AC-04`: Active members can rename or delete an item, with duplicate names
      prevented within one household and destructive removal confirmed in the UI.
- [ ] `AC-05`: The pantry works on phone and desktop and has accessible loading,
      empty, validation, success, conflict, and failure states.
- [ ] `AC-06`: Pantry reads and mutations enforce the Phase 1
      identity/membership boundary, household-scoped D1 access, bounded
      validation, and no food-item or identity data in application logs.
- [ ] `AC-07`: Deterministic local tests cover the migration, API boundary,
      household isolation, concurrent edits, and primary browser journeys
      without remote services; development and production release evidence is
      recorded before completion.

## Experience design

The signed-in family view gains a Pantry section without a new deep URL; the
current application has no client-side router and unknown deep paths do not
resolve to the SPA. Both owners and regular active members may manage pantry
items. The section offers All items and Shopping views, an add-item form, and a
visible count. Shopping is a filter over the same data, not another editable
list. Needed appears before Low; names sort alphabetically within each group.

Each item shows its name, explicit text status, and last-change time. A
three-choice control changes the status with one deliberate action. Rename and
Delete are secondary actions; Delete asks for confirmation with the item's name.
Changing a status to Available immediately removes it from Shopping after the
server confirms the update. The UI does not pretend to decrement stock when a
recipe is planned or cooked. Mobile uses full-width item cards; desktop may use
columns only where the pantry panel is wide enough, without horizontal scrolling
or hidden actions.

The initial empty state explains the three signals and prompts the first item.
An empty Shopping view says there are no items currently marked Low or Needed;
it does not imply the household owns everything. Loading and retry states do not
show stale data as current. Validation explains an invalid or duplicate name.
A stale-edit conflict reloads the latest item and asks the member to review the
change rather than silently overwriting it. Confirmed success is announced
without moving focus unexpectedly.

## Technical design

### Boundaries and contracts

`src/client` owns the form, responsive list, shopping filter, notices, and
confirmation UI. `src/shared` defines the item/status and request/response
contracts. `src/worker` validates untrusted input, resolves the verified Phase 1
member context on every request, and calls household-scoped prepared D1
statements. The browser sends no household ID; the Worker derives it from the
active membership. No new Cloudflare binding or external service is needed.

Proposed JSON endpoints:

| Method   | Path                    | Request                                                | Result                                               |
| -------- | ----------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `GET`    | `/api/pantry/items`     | None                                                   | Household items sorted by signal and name            |
| `POST`   | `/api/pantry/items`     | `{ name, status }`                                     | `201` with created item                              |
| `PATCH`  | `/api/pantry/items/:id` | `{ version, name?, status? }` with at least one change | `200` with updated item or `409` for stale/duplicate |
| `DELETE` | `/api/pantry/items/:id` | `{ version }`                                          | `204` or `409` for a stale item                      |

The item response contains an opaque ID, display name, status, integer version,
and timestamps, but no member email or Access claims. Mutation endpoints use
the existing same-origin and JSON content-type checks. Invalid IDs, unknown
fields/statuses, or overlong bodies fail with the existing structured API error
contract. Missing or revoked membership fails closed. A missing item yields
`404` regardless of whether an ID exists in another household. A `409` means
the client must reload before retrying. The proposed per-household item cap is
500 to bound list and storage costs; reaching it gives a clear validation error.

### Data and migrations

Add forward migration `0002_create_pantry_items.sql` after Phase 1's immutable
`0001`. The proposed `pantry_items` table contains opaque `id`, `household_id`
foreign key, `display_name`, `normalized_name`, `status` (`available`, `low`,
`needed`), positive `version`, `created_source` (`manual` for this phase), and
`created_at`/`updated_at`. Use SQLite `STRICT`, checks, a unique
`(household_id, normalized_name)` constraint, and an index for household list
reads. The normalized key uses Unicode normalization, trimmed/collapsed spaces,
and case folding so small formatting differences do not create duplicates;
display text remains human-readable. A version-checked update/delete includes
both household ID and item ID in its predicate. All requests use prepared
statements.

Pantry rows belong to the household, not to the member who entered them.
Revoking a member removes that person's access but leaves shared pantry data
for the family. Deleting an item removes its current D1 row rather than keeping
an application tombstone. Data remains until an active member deletes the item
or the household is explicitly removed by an authorized operational process;
there is no silent expiry. A future household deletion must remove the
installation pointer and then the household, allowing its pantry rows to
cascade. D1 backups may retain deleted rows until provider retention expires;
the production retention/recovery policy must be checked before rollout. No
export or household-deletion UI is introduced in Phase 2. Source provenance is
explicitly manual; future photo/import flows require their own accepted design
and a forward migration before writing new source kinds.

See the proposed entity relationship and deletion notes in
[`docs/DATA_MODEL.md`](../DATA_MODEL.md).

### Security and privacy

Food names can reveal household habits. Never include names in URLs, logs,
metrics labels, tracing attributes, or third-party calls. Authorize every
request through the Phase 1 member context; the API must not accept a
client-provided household ID. Bound item names (1–80 characters after
normalization), collection size, and request bodies. Apply the existing security
headers and escape display text through React. Test cross-household reads and
mutations using two database households even though the product currently uses
one family. No new secrets are required.

### Accessibility

Use labeled inputs and a fieldset or equivalently named group for the three
signals. Status is communicated in text, not color alone. All actions must be
reachable and operable by keyboard. Deletion confirmation must move focus in,
trap focus, support Escape before submission, and restore focus on dismissal.
Success/error notices use the established semantic output pattern. Desktop and
mobile tests verify readable names, visible controls, and no sideways scrolling.
Manual keyboard review is part of development acceptance; any separate
screen-reader exercise or deferral is an owner decision recorded as evidence.

### Reliability and observability

Only server-confirmed changes update the visible item state. Version-checked
mutations avoid lost updates between family members. On a timeout or uncertain
write result, reload before offering retry; never blindly replay a mutation.
The API returns generic error messages without pantry values. Operational logs
may include route, status, and a non-personal request identifier, but not item
names, member identities, or request bodies. The health endpoint stays
independent of pantry state.

## Test strategy

- Unit: name normalization, three-state shopping filter/order, validation, and
  state transitions, including Unicode/case/space duplicates.
- Worker-runtime integration: apply `0001` plus `0002` to fresh local D1 and
  apply `0002` to an already populated Phase 1 schema; test member/non-member
  access, two-household isolation, all CRUD paths, origin/content-type/body
  checks, duplicate names, list cap, stale versions, and simulated D1 failure.
- Client: loading/empty/Shopping states, validation, successful status change,
  duplicate/stale conflict reconciliation, failure/retry, and delete focus.
- Playwright: owner and regular member journeys on desktop and mobile, including
  add → Low/Needed → Shopping → Available and rename/delete; assert that actions
  and names are visible without horizontal scrolling. Local identity and local
  D1 only. Capture a local screenshot for owner UI review before the development
  deployment.
- Development acceptance: real Access-authenticated owner and member share a
  pantry, see a change across sessions, and verify that a revoked identity
  cannot read it. Review phone/desktop layout and privacy-safe logs. Record
  exact CI/Sonar, migration, deployment, and manual results here.
- Production: only after separate explicit approval, apply the same migration
  through the protected workflow and validate a small owner add/update/view
  journey. Do not use real food names in screenshots or test artifacts.

Test names above match the implementation. Development and production evidence
remains outstanding and is not claimed here.

### Evidence retention

The feature document is the durable index: each criterion links exact test
cases, local result summaries, PR CI/Sonar runs, development manual checks,
and eventual production release evidence. GitHub Actions holds raw run logs;
the PR links the reviewed code, test changes, and gate results. Manual browser
observations and design decisions go into issue comments and are summarized
here. The existing CI workflow uploads a Playwright report only on failure and
retains it for seven days, so it is diagnostic evidence, not the permanent
record. Review screenshots, when useful, should be attached to the issue or
PR without real family data. Do not claim a check passed until its run exists.

## Traceability

| Criterion | Implementation                                                                                                          | Automated tests                                                                                                                                                                                                                                               | Release evidence            |
| --------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `AC-01`   | `src/worker/index.ts` — `handlePantryCollection`; `src/worker/data/pantry-repository.ts` — `listPantryItems`            | `test/worker/pantry.test.ts` — “starts empty and adds an item with a signal but no quantity”; “never lets one household reach another household pantry”; “denies an identity that is not an active member”                                                    | `V-LOCAL-P1`; PR CI pending |
| `AC-02`   | `src/worker/index.ts` — `requirePantryName`/`requirePantryStatus`; `createPantryItem`; `src/client/Pantry.tsx` add form | `src/shared/pantry.test.ts` — normalization matrix; `test/worker/pantry.test.ts` — “treats case, spacing, and Unicode form differences as the same item”; `src/client/Pantry.test.tsx` — “adds an item with the chosen signal and reconciles from the server” | `V-LOCAL-P1`; PR CI pending |
| `AC-03`   | `src/worker/data/pantry-repository.ts` — `updatePantryItem`; `src/shared/pantry.ts` — `shoppingItems`                   | `src/shared/pantry.test.ts` — ordering and shopping filter; `test/worker/pantry.test.ts` — “moves an item in and out of the shopping view by signal”; `tests/e2e/pantry.spec.ts` — “an item moves through Needed, Shopping, and Available”                    | `V-LOCAL-P1`; PR CI pending |
| `AC-04`   | `src/worker/data/pantry-repository.ts` — `deletePantryItem`, `nameTaken`; `src/client/Pantry.tsx` rename/remove         | `test/worker/pantry.test.ts` — “renames an item and rejects renaming onto another item”; “deletes an item only with its current version”; `tests/e2e/pantry.spec.ts` — “an item can be renamed and removed with confirmation”                                 | `V-LOCAL-P1`; PR CI pending |
| `AC-05`   | `src/client/Pantry.tsx`; `src/client/styles.css` — pantry rules                                                         | `src/client/Pantry.test.tsx` — loading, empty, validation, conflict, failure, focus, and dialog tests; `tests/e2e/pantry.spec.ts` — “pantry names and actions fit the panel without sideways scrolling” on desktop and mobile                                 | `V-LOCAL-P1`; PR CI pending |
| `AC-06`   | `src/worker/index.ts` — `requireMemberForRequest` and mutation header checks; scoped prepared statements                | `test/worker/pantry.test.ts` — “requires same-origin JSON for every pantry mutation”; “rejects invalid names, statuses, versions, and unexpected fields”; “caps the pantry per household and keeps the message free of item names”                            | `V-LOCAL-P1`; PR CI pending |
| `AC-07`   | `migrations/0002_create_pantry_items.sql`; `test/worker/helpers.ts`                                                     | `test/worker/migration.test.ts` — “applies 0002 on top of the Phase 1 schema without altering it”; constraint and cascade tests; full client/Worker/Playwright suites                                                                                         | `V-LOCAL-P1`; dev pending   |

Development and production release evidence is added as each gate runs.

## Rollout and rollback

1. ~~Review and accept this design in
   [issue #16](https://github.com/wpliao/meal-planner/issues/16).~~ Accepted on
   2026-09-21; implementation may begin once this status reaches `main`.
2. ~~Implement migration `0002`, application behavior, tests, and data-model
   documentation together.~~ Done in
   [#18](https://github.com/wpliao/meal-planner/pull/18); PR CI, Sonar, and the
   independent security review run against that pull request.
3. Apply migration in development through the named workflow; validate with
   real family identities and record the results.
4. Obtain separate owner approval for production. The production workflow
   applies pending migration before deploying the reviewed commit. Record
   migration, Worker version, owner validation, and any follow-ups here.

The migration is additive. If application code must roll back, redeploy the
last known-good version while leaving the unused table in place; do not edit
or reverse an applied migration. Preserve pantry rows for a forward fix unless
the owner explicitly requests deletion. Inspect D1 backup/restore options
before any destructive recovery. Development and production never share D1.

## Resolved design decisions

The product owner resolved these on 2026-09-21 in the
[approval record](https://github.com/wpliao/meal-planner/issues/16#issuecomment-5757123841). They are settled for Phase 2; reopening any of them
requires a design change recorded in the decision log below.

- **Signals**: **Available / Low / Needed** are the correct three manual
  signals. Both Low and Needed appear in Shopping, with Needed ordered first.
  Marking an item Available removes it from Shopping.
- **Edit access**: every **active household member** may add, rename, re-signal,
  and delete pantry items, not only an owner.
- **Scope**: quantities, units, expiry dates, and automatic consumption tracking
  stay out of Phase 2. Signals remain manually maintained.

## Decision and change log

| Date       | Change                                                                                                                            | Reason                                                                                                                      | Evidence                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 2026-09-21 | Initial lightweight pantry design proposed for owner review                                                                       | Keep availability useful without exact-use bookkeeping                                                                      | [Issue #16](https://github.com/wpliao/meal-planner/issues/16)                               |
| 2026-09-21 | Implementation added migration `0002`, the pantry API, the shared pantry section, and the full local test set                     | Turn the accepted design into shipping behavior within the agreed scope                                                     | [#18](https://github.com/wpliao/meal-planner/pull/18); `V-LOCAL-P1`                         |
| 2026-09-21 | Optimistic concurrency uses an integer `version` column with `409 stale_version`, and duplicate names return `409 duplicate_name` | A stale screen must never silently overwrite another member's change, and the two conflicts need different recovery actions | `V-LOCAL-P1`; concurrent-edit test                                                          |
| 2026-09-21 | The per-household cap is enforced by a guarded `INSERT ... SELECT ... WHERE (count) < limit` rather than a separate count         | Counting first and inserting afterwards would let two concurrent adds exceed the cap                                        | `V-LOCAL-P1`                                                                                |
| 2026-09-21 | Product owner accepted the design and authorized implementation; the three open decisions were confirmed as proposed              | The signal model, shared member edit access, and the exclusion of quantities match the intended lightweight pantry          | [Approval record](https://github.com/wpliao/meal-planner/issues/16#issuecomment-5757123841) |

## Release record

- Design approval: Accepted on 2026-09-21 ([approval record](https://github.com/wpliao/meal-planner/issues/16#issuecomment-5757123841))
- Local verification: `V-LOCAL-P1` (2026-09-21) — `./scripts/verify.sh` passed:
  formatting, lint, typecheck, 55 client tests, 70 Worker-runtime tests,
  coverage thresholds, production build, and 25 Playwright tests across desktop,
  mobile, and the asset pipeline.
- Development validation: Pending
- Production release: Pending separate explicit approval
- Known follow-up work: Recipe linkage, nutrition, photos, and automatic
  suggestions remain in later phases.
