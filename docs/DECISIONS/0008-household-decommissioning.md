# ADR 0008: Household transfer and decommissioning

- Status: Accepted
- Date: 2026-09-22
- Feature: [Household lifecycle](../features/0032-household-lifecycle.md)
- Issue: [#32](https://github.com/wpliao/meal-planner/issues/32)
- Accepted by product owner: [Issue comment](https://github.com/wpliao/meal-planner/issues/32#issuecomment-5774536685)

## Context

The installation currently has one household. Active owners can promote an
active member and the database rejects demoting or revoking the last active
owner. The application has no whole-household deletion path. The
`app_installation` foreign key restricts deletion of `households`; pantry rows
cascade only after the installation pointer is removed. Removing that pointer
also makes the one-time bootstrap path available again if the Worker and
Cloudflare Access remain reachable. Recipes would add another dependent table.

The owner chose an [operator procedure with a development
rehearsal](https://github.com/wpliao/meal-planner/issues/32#issuecomment-5773995645)
for complete deletion. Production data destruction still requires its own
explicit approval; accepting this design would not approve a deletion.

## Options considered

### Self-service application deletion

The owner could confirm deletion in the family interface. This would require a
new destructive API route, reauthentication and race controls, a way to block
new bootstrap, and a safe state if Access or D1 cleanup fails. It is too much
permanent public surface for a single private household and is not the owner's
chosen first step.

### Direct manual SQL

An operator could issue remote D1 commands. That is quick but provides weak
reviewability and makes a wrong environment, wrong household ID, or incomplete
two-statement deletion too easy. It is not the proposed production path.

### Owner-approved operator workflow

A dedicated manual GitHub workflow can bind to the existing environment-scoped
credentials, require an exact typed confirmation, verify the target and current
schema, and run a parameterized, transactional deletion. It can record a run URL
without printing family data. Development rehearses the same path first. The
production branch and owner-approval process follow
[ADR 0011](0011-production-environment-required-reviewer.md), which added an
enforced production environment reviewer once the repository became public.

## Decision

Use the existing owner/member API for ordinary transfer: promote an active
successor, have the successor verify owner access, and only then demote or
revoke the previous owner. Preserve the last-active-owner invariant. An
unavailable previous owner requires separately approved recovery; there is no
automatic privilege escalation.

Use an **owner-approved operator workflow**, separate from deployment, for
whole-household deletion. Require the owner request to be recorded before the
run, select exactly one environment and expected household, enforce the
production `main` branch policy and literal confirmation, and use a narrowly
scoped credential. Stop family access before removing the installation pointer
so bootstrap cannot re-open. Run the installation-pointer delete and household
delete as one D1 batch, relying on foreign-key cascades for members, pantry,
and later recipes. Verify atomicity and cascades in the Workers runtime and
rehearse the full workflow in development before production eligibility.

Keep the Access policy denying access and the Worker route disabled after a
successful deletion. A future rebootstrap is a new, separately accepted setup
decision. Cloudflare Access configuration, R2 objects introduced by a later
feature, and D1 Time Travel history are outside SQL foreign-key cascades and
must be handled explicitly in the runbook.

## Consequences and open checks

- No new public deletion endpoint or self-service button is added.
- The operator workflow is a privileged delivery path. Its token scope,
  environment selection, branch restriction, confirmation, output redaction,
  and failure behavior need security review.
- Cloudflare's [D1 batch
  documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
  describes transactional rollback on failure. The REST batch used by the
  operator script must be shown to have the same property in development
  before the procedure is eligible for production use.
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
  can retain deleted live rows within the account plan's recovery window.
  Deletion must be described as removal from the live database, not immediate
  erasure from provider history. Determine the actual environment plan and
  document its window before any production deletion.
- A Time Travel restore overwrites the database in place. Recovery needs a
  separate owner decision and must not silently re-enable Access or bootstrap.
- Acceptance of this ADR authorizes implementation and testing of the design;
  it does not authorize a production deletion. The exact closure, batch, and
  retention checks must pass before the operator workflow is eligible for use.
