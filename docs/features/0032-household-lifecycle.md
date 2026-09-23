# Feature: Household ownership transfer and deletion

- Status: Implementing
- Phase: Phase 1 follow-up; prerequisite for Phase 3 data
- Issue: [#32](https://github.com/wpliao/meal-planner/issues/32)
- Product owner: Repository owner
- Last updated: 2026-09-22
- Pull requests: [#34](https://github.com/wpliao/meal-planner/pull/34) (accepted
  design); [#35](https://github.com/wpliao/meal-planner/pull/35) (`AC-01`
  transfer); [#36](https://github.com/wpliao/meal-planner/pull/36) (transfer
  validation and release record);
  [#39](https://github.com/wpliao/meal-planner/pull/39) (`AC-02` operator
  decommission workflow)

## Problem and outcome

The family can add and remove members, but a complete transfer to a successor
owner and deletion of the only household are not documented end to end. A
person who owns the family space needs a safe transfer sequence. If the owner
requests whole-household deletion, an operator needs a procedure that removes
live family and identity data without exposing the bootstrap path or targeting
the wrong environment.

The owner selected an
[operator procedure with a development
rehearsal](https://github.com/wpliao/meal-planner/issues/32#issuecomment-5773995645)
for deletion and [accepted this
design](https://github.com/wpliao/meal-planner/issues/32#issuecomment-5774536685).
The implementation gates below must be verified before a deletion workflow is
eligible for use. Acceptance does not authorize a production deletion.

## User scenarios

1. Given an active member who will take over, when the current owner promotes
   them, then the successor can confirm owner access before the first owner
   steps down.
2. Given only one active owner, when anyone tries to demote or revoke them,
   then the operation fails and the household remains administered.
3. Given an owner request to delete the household, when an operator prepares
   the procedure, then the owner receives the live-data and history-retention
   explanation and the exact environment is checked before any change.
4. Given a rehearsed and separately approved production deletion, when the
   operator completes it, then live identity, pantry, and recipe rows are gone,
   bootstrap cannot reopen, and verification evidence contains no family data.
5. Given a failed or partial attempt, when the operator investigates, then
   access stays closed and recovery requires a separate owner decision.

## Scope

- Included: an owner transfer guide using the existing role actions;
  deterministic transfer tests; a dedicated operator decommission procedure;
  development rehearsal, production approval and verification evidence; live
  household, membership, pantry, and future recipe-row deletion semantics.
- Not included: self-service household deletion, multiple households per
  identity, data export, a new public deletion API, automatic recovery, or any
  production deletion under this design. Future R2 objects require an update
  to this procedure before a photo feature can ship.

## Acceptance criteria

These stable identifiers mirror
[issue #32](https://github.com/wpliao/meal-planner/issues/32).

- [x] `AC-01`: A documented, tested ownership-transfer sequence moves owner
      responsibility to an active member and preserves the last-active-owner
      rule throughout; failures leave at least one active owner.
- [ ] `AC-02`: A documented household-deletion design covers authorization,
      explicit confirmation, the installation pointer, member records, pantry
      items, future recipes, Access configuration, and D1 history/backup
      retention.
- [ ] `AC-03`: The chosen transfer and deletion paths are tested in the actual
      Workers runtime and validated in development before being offered or
      used in production; no production deletion occurs without separate
      explicit approval.

## Experience design

Transfer is a guided use of the existing Family member controls. The owner
invites and activates the successor if needed, promotes that **active** member,
asks the successor to sign in and confirm they can reach owner management,
then demotes or revokes their own membership. The UI should explain this order
near the role action. The current last-owner conflict remains visible and
recoverable. A successor who has not confirmed access is never treated as a
completed transfer. No email, sign-in link, or Access assertion is sent through
the app.

Whole-household deletion is requested outside the application. The owner sees
a plain-language summary before approving: live household/member/pantry/recipe
data will be removed, the application becomes unavailable, and D1 history may
remain recoverable for the provider window. The owner records explicit approval
for the **specific environment** and run. An operator then carries out the
reviewed checklist. No permanent Delete button appears in the family UI.

## Technical design

### Boundaries and contracts

Ordinary transfer uses the existing owner-only `PATCH
/api/household/members/:memberId` role and status operations under
[ADR 0004](../DECISIONS/0004-access-identity-and-household-authorization.md).
The target must be active. The SQL guard already rejects demotion/revocation
of the last active owner; a focused test must prove the complete sequence and
concurrent demotions. No new public API is proposed.

Whole-household deletion runs through a dedicated, manually dispatched
operator workflow under
[ADR 0005](../DECISIONS/0005-production-deployment-approval-on-github-pro.md)
and proposed [ADR 0008](../DECISIONS/0008-household-decommissioning.md). The
workflow uses environment-scoped credentials and an exact confirmation input.
Production runs only from `main` after owner approval is recorded in issue #32
or a linked private operational issue. The script accepts an environment and
expected opaque household ID; it refuses to proceed if the D1 resource ID,
installed household, schema/migrations, or table inventory differs from the
reviewed target. No personal record values are printed.

### Data, deletion order, and retention

No schema migration is proposed for this design. The existing
`app_installation.household_id` foreign key is `ON DELETE RESTRICT`; membership
and pantry foreign keys are `ON DELETE CASCADE`. A Phase 3 recipe migration must
make recipe children cascade from the same household. With Access closed and
the correct installation verified, the deletion batch removes the installation
pointer and then the household. The household delete cascades to membership,
pantry, and recipe rows. The batch must be atomic so a failed second statement
does not leave an unguarded installation.

The operator procedure has these stages:

1. **Approval and preflight.** Verify the requester against the current active
   owner through the established private contact channel and record the
   confirmation without publishing their email. Record the owner's request and
   a separate production approval. Identify the exact environment, Worker, D1
   ID, Access application, and installed household. Check migration state,
   one-household invariant, and counts of owned rows. Capture a D1 Time Travel
   bookmark and the plan's recovery-window length. Record counts and bookmark
   only in a private operational record, never record names, emails, or recipe
   content.
2. **Close access.** Change the environment's Access policy to deny family
   entry and disable its Worker route before clearing `app_installation`. Have
   the owner/operator verify a formerly authorized sign-in no longer reaches
   the app. Keep this closure in place through verification and after success.
   A failed closure stops the procedure with D1 untouched.
3. **Delete live rows.** Run the parameterized installation-pointer and
   household deletes as one D1 batch. Match the reviewed household ID in both
   statements; never interpolate it into SQL. Stop and keep access closed on
   any error or unexpected affected-row count.
4. **Verify and retire.** Query only counts for `app_installation`,
   `households`, `household_members`, `pantry_items`, `recipes`, `recipe_ingredients`, and
   `recipe_steps`. All must be zero for the target. Confirm bootstrap remains
   unreachable, retire the Access application and Worker route through a
   separately checked step, and remove environment secrets when no longer
   needed. Record the workflow run, time, count-only result, and remaining
   Time Travel window. Keep development and production evidence separate.

Access settings, Worker route, and D1 Time Travel are not removed by SQL
cascades. R2 is currently reserved but stores no product data. Before an
R2-using feature releases, this design must be extended with object-key
inventory, deletion, and lifecycle verification. Do not claim immediate
irrecoverable erasure: [Cloudflare's Time Travel
documentation](https://developers.cloudflare.com/d1/reference/time-travel/)
describes a 7-day recovery window on Workers Free and 30 days on Workers Paid;
the actual account plan must be checked before a real request.

### Security and privacy

Only an authorized owner can request deletion, and only an operator with
scoped environment credentials can execute it. The approval record names the
environment and intent without family content. The production branch policy,
literal confirmation, and recorded owner approval follow ADR 0005; the private
repository cannot enforce a separate reviewer. The workflow never accepts a
household ID from a browser request, never logs rows, and never puts a deletion
credential in `VITE_*` or source control. Close Access and the Worker route
before removing the pointer so the bootstrap email cannot create a new
household during or after deletion.

The [D1 `batch()` API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
documents rollback of the whole batch when a statement fails. The chosen
operator transport must demonstrate equivalent behavior in development before
production eligibility. The application must remain closed if the control
plane or D1 cannot confirm any step.

### Accessibility

The transfer guidance uses ordinary text next to the labelled role controls.
Existing confirmation dialogs retain keyboard focus trapping and return. A
role conflict is announced without implying transfer succeeded. The deletion
checklist is readable without a browser interaction and makes the irreversible
effects and retention window clear to the owner.

### Reliability and observability

Every stage is fail-closed and records only environment, opaque IDs, counts,
timestamps, and run links in restricted records. An unexpected affected-row
count is a failure, even if the API returns success. A retry first re-runs
read-only preflight; it never assumes the previous run did nothing. Access
stays closed until a reviewed resolution. A Time Travel restore overwrites
the live D1 database and is never automatic; it needs a new owner approval and
post-restore authorization check.

## Test strategy

- Workers-runtime tests for promote → successor owner session → previous owner
  demotion/revocation, non-owner denial, inactive successor rejection, and
  concurrent final-owner changes. Reuse the real D1 schema and identity
  adapter; do not weaken existing Phase 1 tests.
- Workers-runtime rehearsal of the same parameterized deletion statements:
  pointer restriction, child cascades (including recipes and their lines),
  wrong-household refusal, second-statement failure rollback, and no bootstrap
  access while the decommission gate is active.
- Local operator-script tests with a fake Cloudflare API for target mismatch,
  denied Access closure, missing approval, failed batch, unexpected counts,
  secret redaction, and retry behavior. No test calls remote services.
- Development-only rehearsal through the protected workflow against an
  isolated disposable D1/Access setup, or after separately approved reset of
  the existing development data. Do not delete existing development family
  data to create a fixture. Record the owner-observed denial, D1 count result,
  and bootstrap refusal. Re-establish a usable development environment before
  future feature validation.
- Full `./scripts/verify.sh`, CI, Sonar, and security review before deployment.
  A production run has its own separately recorded owner approval and must
  never be used as a test.

## Traceability

Exact evidence replaces planned entries as implementation and validation
proceed. `AC-01` is implemented, tested, and validated in development
(`V-DEV-H1`). `AC-02` is implemented in
[PR #39](https://github.com/wpliao/meal-planner/pull/39), merged to `main` on
2026-09-23; its independent security review found no high-severity issue and
left one medium finding (D1 REST batch atomicity) open until the development
rehearsal. `AC-03` has development validation for the transfer path
only; the deletion path has not been rehearsed and production is refused.

| Criterion | Planned implementation                                                                                                                                                                                                                                                                                                                                                                                                                                 | Planned evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Release evidence                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `AC-01`   | `src/client/FamilySpace.tsx` transfer guidance and self-step-down confirmation; existing `changeMemberRole` and `changeMemberStatus`                                                                                                                                                                                                                                                                                                                   | `test/worker/members.test.ts` — `transfers ownership only after an active successor confirms owner access`, `protects the final active owner from demotion and revocation`, `preserves an active owner under concurrent owner demotions`; `tests/e2e/family-boundary.spec.ts` — `successor confirms owner access before the first owner steps down`; `src/client/App.test.tsx` — `names the other owner when confirming their demotion or revocation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `V-DEV-H1`; `V-PROD-H1`; CI and Sonar passed         |
| `AC-02`   | `src/operations/household-decommission/` — `sql.ts` (`deletionBatch`, `householdCountsStatement`, `acceptableDeletionChanges`, `EXPECTED_TABLES`), `procedure.ts` (`runDecommission`), `cloudflare-client.ts`, `config.ts`, `redact.ts`, `cli.ts`; `scripts/household-decommission.ts`; `.github/workflows/household-decommission.yml`; [runbook](../operations/household-decommission.md); [ADR 0008](../DECISIONS/0008-household-decommissioning.md) | `test/worker/household-decommission.test.ts` — `accounts for exactly the tables and migrations of the real schema`; `counts only the target household rows before deletion`; `cannot delete a household while the installation pointer references it`; `removes the pointer and household and cascades members, pantry, and recipe rows`; `deletes nothing when the reviewed household is not the installed one`; `deletes nothing for an unknown household ID`; `rolls back the pointer delete when the household delete fails`; `keeps bootstrap closed to everyone but the configured identity after deletion`; `deletes the installed household through the REST request shape`; `refuses a household that is not the installed one without deleting anything`; `refuses a second run after a completed deletion`. `test/operations/decommission-procedure.test.ts` — `runs preflight, closure, one deletion batch, and verification in order`; `sends the exact parameterized batch in a single D1 REST request`; `prints only environment, opaque IDs, counts, stages, and timestamps`; `approval › stops on %s before any Cloudflare call`; `refuses production before any Cloudflare call`; `target mismatch › stops on %s with D1 untouched`; `access closure › stops with D1 untouched when %s`; `deletion batch › never retries the destructive batch after %s`; `verification › fails when verification finds %s`; `retries › retries a transient read and then succeeds`; `retries › re-runs read-only preflight on a new run after an ambiguous batch failure`; `secret redaction › keeps the token out of output when fetch throws an error that contains it`. `test/operations/config.test.ts` — `refuses production until rehearsal evidence and a separate approval exist`; `refuses %s` | PR #39 CI and Sonar passed; rehearsal pending        |
| `AC-03`   | Development rehearsal through `.github/workflows/household-decommission.yml`; production refused by its `refuse-production` job and `PRODUCTION_INELIGIBLE_MESSAGE`                                                                                                                                                                                                                                                                                    | `./scripts/verify.sh`; PR CI/Sonar; development rehearsal run proving gates 1–2; gate 3 Time Travel plan check; owner acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Transfer: `V-DEV-H1`, `V-PROD-H1`. Deletion: pending |

## Rollout and rollback

Product-owner acceptance of this issue, design, and ADR precedes implementation.
Implement and review transfer guidance and the operator workflow without
touching production. Rehearse in development with disposable data and record
the result. Keep the production deletion workflow disabled or otherwise
ineligible until that evidence and a separate owner approval exist.

A failed attempt keeps Access closed. If D1 deletion did not commit, resolve
the failure and reopen only after owner review. If it committed incorrectly,
assess the captured Time Travel bookmark and the effect of an in-place restore;
restore requires another explicit approval. Do not create or alter an applied
migration to recover live data. A successful requested deletion is not rolled
back automatically.

## Implementation gates before a deletion workflow is eligible

1. Confirm the exact Access/Worker closure mechanism and how the workflow
   proves it without exposing an authorization secret.
2. Confirm the operator transport uses a parameterized D1 batch with atomic
   rollback, and rehearse its real behavior in development.
3. Confirm the production account's D1 Time Travel window and the owner-facing
   wording for retained provider history before any production deletion.
   The owner confirmed on 2026-09-23 that the account is on **Workers Free**,
   so the window is **7 days**; quote 7 days in the owner summary. Re-check the
   plan immediately before any production request, because an upgrade changes
   the window to 30 days.

## Decision and change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Reason                                                                                                                                                | Evidence                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-22 | Initial proposal; status `Designing`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Close the Phase 1 household lifecycle gap before adding recipe data                                                                                   | [Issue #32](https://github.com/wpliao/meal-planner/issues/32)                                                                                                                                                                              |
| 2026-09-22 | Propose owner-approved operator deletion with development rehearsal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Product-owner preference over a self-service control                                                                                                  | [Owner decision](https://github.com/wpliao/meal-planner/issues/32#issuecomment-5773995645)                                                                                                                                                 |
| 2026-09-22 | Accept design and stabilize `AC-01`–`AC-03`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Product owner approved PR #34 design; operational gates remain                                                                                        | [Approval](https://github.com/wpliao/meal-planner/issues/32#issuecomment-5774536685)                                                                                                                                                       |
| 2026-09-22 | Begin `AC-01` ownership-transfer implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The existing role API supports the accepted sequence                                                                                                  | [PR #35](https://github.com/wpliao/meal-planner/pull/35)                                                                                                                                                                                   |
| 2026-09-22 | Record `V-DEV-H1` transfer validation in development                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `af7ecbf` deployed and checked by the owner                                                                                                           | [Deploy run](https://github.com/wpliao/meal-planner/actions/runs/35730748359)                                                                                                                                                              |
| 2026-09-22 | Record `V-PROD-H1` transfer release to production                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Owner dispatched the production deploy of `af7ecbf`                                                                                                   | [Deploy run](https://github.com/wpliao/meal-planner/actions/runs/35742602377)                                                                                                                                                              |
| 2026-09-23 | Implement the `AC-02` operator workflow. Reversible defaults awaiting owner review: the operator closes Access and the Worker route by hand and the workflow only verifies closure read-only (least-privilege token); both `[1, 1]` and cascade-inclusive affected-row counts are accepted until the rehearsal shows what the REST API reports; confirmation literal `DECOMMISSION_DEVELOPMENT_HOUSEHOLD`; preflight refuses any table it does not count, so the `recipes` count must be added by whichever of #39 and the recipe migration PR merges second | Gate 1 and gate 2 remain unresolved by code and need the development rehearsal; a Workers-runtime finding showed D1 counts cascaded rows in `changes` | [PR #39](https://github.com/wpliao/meal-planner/pull/39)                                                                                                                                                                                   |
| 2026-09-23 | Account for the recipe tables in the `AC-02` procedure: the count query, preflight foreign-row check, expected table inventory, and accepted cascade-inclusive affected-row count now cover `recipes`, `recipe_ingredients`, and `recipe_steps`                                                                                                                                                                                                                                                                                                              | PR #38 merged migration `0003` first, so #39, merging second, owed the check agreed in both PRs; without it the preflight refused the new tables      | `test/worker/household-decommission.test.ts` shows the Workers-runtime D1 counts nested recipe-line cascades in `changes`; `test/operations/decommission-procedure.test.ts` covers foreign and remaining recipe, ingredient, and step rows |
| 2026-09-23 | Record the Time Travel window for gate 3: the account is on Workers Free (7 days)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Gate 3 requires the actual plan before any production deletion; the owner checked the Cloudflare dashboard                                            | Owner report, 2026-09-23                                                                                                                                                                                                                   |

## Release record

- Local verification: `./scripts/verify.sh` passed in the Dev Container on
  2026-09-22 for the accepted design branch (format, lint, typecheck, 60 client
  tests, 76 Workers-runtime tests, build, and 92 Playwright tests). For the
  `AC-01` transfer implementation it passed in the Dev Container on 2026-09-22
  (format, lint, typecheck, 61 client tests, 77 Workers-runtime tests, build,
  and 96 Playwright tests across Chromium and WebKit at desktop and phone
  sizes). The `members panel` visual baselines were regenerated for the added
  transfer guidance after the rendered images were reviewed.
- Development validation: `V-DEV-H1` (transfer path, `AC-01`) complete on
  2026-09-22. `af7ecbf` was deployed to development by
  [Deploy run 35730748359](https://github.com/wpliao/meal-planner/actions/runs/35730748359)
  (Worker version `90971fe0-23ce-4ac1-8ed1-0543116b0ed4`; the in-workflow
  `./scripts/verify.sh` passed with 61 client, 77 Workers-runtime, and 96
  Playwright tests). There is no migration, and none was applied. The owner
  reported completing the transfer check with real Cloudflare Access
  identities: invite and activate a successor, promote them, confirm the
  successor reaches member management, then step the first owner down through
  the self-demotion warning. The owner also confirmed that the successor,
  as the last active owner, was refused when trying to demote themselves.
  The deletion path has no development validation yet.
- Production release: `V-PROD-H1` (transfer path, `AC-01`) complete on
  2026-09-22. The owner approved and dispatched the deploy
  ([release record](https://github.com/wpliao/meal-planner/issues/32#issuecomment-5778690013)); `af7ecbf` deployed through the protected workflow
  ([run 35742602377](https://github.com/wpliao/meal-planner/actions/runs/35742602377))
  as version `b5d7c32b-2be5-4020-b29a-0b0de89db27c` of
  `family-meal-planner-production`. No migrations were applied. The feature is
  not `Released`: `AC-02` and the deletion part of `AC-03` remain open, and no
  household deletion is authorized.
- Known follow-up work: Phase 3 recipes are now counted by this procedure
  (PR #39, after PR #38 added migration `0003`);
  future R2-backed data requires a further deletion design update.
