# Feature: <name>

- Status: Proposed
- Phase: <phase>
- Issue: <GitHub issue URL>
- Product owner: <name>
- Last updated: YYYY-MM-DD
- Pull requests: <links or none>

## Problem and outcome

Describe the user problem, who experiences it, and the observable outcome. Avoid
describing implementation as the goal.

## User scenarios

1. Given <context>, when <action>, then <outcome>.

## Scope

- Included: <behavior>
- Not included: <explicit non-goal>

## Acceptance criteria

Identifiers are stable after the design is accepted. Mark changed or superseded
criteria and explain the change in the decision log; do not silently renumber or
delete them.

- [ ] `AC-01`: <observable behavior>
- [ ] `AC-02`: <observable behavior>

## Experience design

Document the user flow, responsive behavior, loading, empty, success, validation,
authorization, and failure states. Link approved wireframes or prototypes when
they exist.

## Technical design

### Boundaries and contracts

Describe client, Worker, shared contract, and external-service changes.

### Data and migrations

Describe ownership, entities, constraints, provenance, retention, deletion,
migration order, and recovery. Write `Not applicable` with a reason when no data
changes exist.

### Security and privacy

Describe identity, authorization, validation, secrets, logging, abuse cases, and
data disclosed to third parties.

### Accessibility

Describe semantics, keyboard and screen-reader behavior, focus, contrast, motion,
and relevant manual checks.

### Reliability and observability

Describe expected failures, idempotency, timeouts, retries, safe logs, metrics,
and support behavior.

## Test strategy

Describe unit, Worker-runtime integration, browser/E2E, migration, and manual
validation coverage. Tests must not require paid or remote services.

## Traceability

Use relative Markdown links to repository files and include exact exported symbol
or test names. Add rows as necessary; do not use line numbers as durable links.

| Criterion | Implementation        | Automated tests               | Release evidence |
| --------- | --------------------- | ----------------------------- | ---------------- |
| `AC-01`   | `<path>` — `<symbol>` | `<test path>` — “<test name>” | Pending          |
| `AC-02`   | `<path>` — `<symbol>` | `<test path>` — “<test name>” | Pending          |

## Rollout and rollback

Describe configuration, migration, development validation, production approval,
feature flagging if needed, and safe rollback or forward recovery.

## Decision and change log

Append entries whenever accepted scope or design changes. Link the issue or pull
request that provides context.

| Date       | Change           | Reason   | Evidence      |
| ---------- | ---------------- | -------- | ------------- |
| YYYY-MM-DD | Initial proposal | <reason> | <issue or PR> |

## Release record

- Development validation: Pending
- Production release: Pending
- Known follow-up work: None
