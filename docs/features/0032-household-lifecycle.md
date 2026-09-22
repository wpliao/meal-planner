# Feature: Household ownership transfer and deletion

- Status: Designing
- Phase: Phase 1 follow-up; prerequisite for Phase 3 data
- Issue: [#32](https://github.com/wpliao/meal-planner/issues/32)
- Product owner: Repository owner
- Last updated: 2026-09-22
- Pull requests: [#34](https://github.com/wpliao/meal-planner/pull/34) (design
  proposal)

## Problem and outcome

The family can add and remove members, but a complete transfer to a successor
owner and deletion of the only household are not documented end to end. A
person who owns the family space needs a safe transfer sequence. If the owner
requests whole-household deletion, an operator needs a procedure that removes
live family and identity data without exposing the bootstrap path or targeting
the wrong environment.

This is a **proposal**. The owner selected an
[operator procedure with a development
rehearsal](https://github.com/wpliao/meal-planner/issues/32#issuecomment-5773995645)
for deletion. The exact controls below still need review before the design can
be `Accepted`. No deletion or production action is authorized here.

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
  production deletion under this proposal. Future R2 objects require an update
  to this procedure before a photo feature can ship.

## Acceptance criteria

These identifiers mirror [issue #32](https://github.com/wpliao/meal-planner/issues/32)
and become stable after acceptance.

- [ ] `AC-01`: A documented, tested ownership-transfer sequence moves owner
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
   `households`, `household_members`, `pantry_items`, and `recipes` once that
   table exists. All must be zero for the target. Confirm bootstrap remains
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
  pointer restriction, child cascades (including recipes once migrated),
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

Planned evidence is named here; replace it with exact symbols, tests, and
workflow runs as implementation and validation proceed.

| Criterion | Planned implementation                                                                                                                | Planned evidence                                                                                                                           | Release evidence |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `AC-01`   | `src/client/FamilySpace.tsx` transfer guidance; existing `changeMemberRole` and `changeMemberStatus`                                  | `test/worker/members.test.ts` — full transfer and final-owner cases; `tests/e2e/family-boundary.spec.ts` — successor confirms owner access | Pending          |
| `AC-02`   | `scripts/` decommission procedure; `.github/workflows/` operator workflow; [ADR 0008](../DECISIONS/0008-household-decommissioning.md) | Workers-runtime cascade/rollback cases; operator-script target and redaction tests; approved runbook                                       | Pending          |
| `AC-03`   | Development rehearsal and guarded production workflow                                                                                 | `./scripts/verify.sh`; PR CI/Sonar; development workflow run and owner acceptance                                                          | Pending          |

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

## Open decisions before acceptance

1. Confirm the exact Access/Worker closure mechanism and how the workflow
   proves it without exposing an authorization secret.
2. Confirm the operator transport uses a parameterized D1 batch with atomic
   rollback, and rehearse its real behavior in development.
3. Confirm the production account's D1 Time Travel window and the owner-facing
   wording for retained provider history before any production deletion.

## Decision and change log

| Date       | Change                                                              | Reason                                                              | Evidence                                                                                   |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 2026-09-22 | Initial proposal; status `Designing`                                | Close the Phase 1 household lifecycle gap before adding recipe data | [Issue #32](https://github.com/wpliao/meal-planner/issues/32)                              |
| 2026-09-22 | Propose owner-approved operator deletion with development rehearsal | Product-owner preference over a self-service control                | [Owner decision](https://github.com/wpliao/meal-planner/issues/32#issuecomment-5773995645) |

## Release record

- Local verification: `./scripts/verify.sh` passed in the Dev Container on
  2026-09-22 (format, lint, typecheck, 60 client tests, 76 Workers-runtime
  tests, build, and 92 Playwright tests). This verifies the design-only branch;
  the proposed transfer and deletion behavior has not been implemented.
- Development validation: Pending
- Production release: Pending; no deletion is authorized
- Known follow-up work: Phase 3 recipes must link its rows to this procedure;
  future R2-backed data requires a further deletion design update.
