# Feature lifecycle and traceability

## Purpose

Every product feature must remain understandable from intent through design,
implementation, verification, and release. Git history is useful evidence, but
it is not a substitute for an explicit feature record. This workflow keeps the
record in the repository and GitHub rather than in an agent conversation.

## Records and ownership

Each feature has these linked records:

1. A GitHub feature issue is the canonical statement of the problem, scope, and
   accepted outcome. Assign it to the appropriate phase milestone.
2. A versioned design document at
   `docs/features/<issue-number>-<short-slug>.md` describes the experience,
   technical design, risks, and traceability.
3. Focused pull requests link the issue and design and update both implementation
   and documentation together.
4. Automated tests prove stable acceptance criteria. CI and Sonar provide remote
   quality evidence.
5. The feature document records development acceptance, production release, and
   later changes.

Pull requests per feature, normally two plus a record:

1. The design pull request. It merges only once the design says `Accepted`.
2. The implementation pull request. The design may split it into sequential
   pull requests, each started from `main` after the previous one merges.
3. One release-record pull request after production. It records development
   validation and the production release together, and closes the issue.
   Under the standing authorization in `AGENTS.md`, an agent may merge it once
   `Verify` passes.

The feature issue number is the stable feature identifier. Acceptance criteria
inside the feature use stable identifiers such as `AC-01` and `AC-02`.

## Lifecycle

### 1. Discover

- Describe the user problem and primary scenarios.
- Define measurable acceptance criteria and explicit non-goals.
- Identify privacy, security, accessibility, data, operational, and cost risks.
- Create the GitHub issue from the feature template.

### 2. Design

- Copy `docs/features/TEMPLATE.md` to a file named for the issue.
- Describe UX states, API contracts, data ownership, migrations, authorization,
  failure behavior, observability, rollout, and rollback as applicable.
- Record open questions and resolve decisions that would materially change the
  result.
- Set the design status to `Accepted` only after product-owner agreement. Coding
  may then begin.

### 3. Implement

- Work on a focused `codex/` or `claude/` branch, named for the authoring tool,
  and keep changes within the accepted scope.
- Add the lowest-cost test for each behavior, plus Worker integration or
  Playwright coverage at important boundaries.
- Update the traceability table as code and tests take shape. Link file paths and
  named symbols or test cases; avoid fragile line-number references.
- Update the design and decision log in the same pull request when implementation
  reveals a necessary change.

### 4. Verify

- Require the pull request's `Verify` check, CI's full gate, and record its
  result. Run targeted checks locally while working, and the full
  `./scripts/verify.sh` before opening a large implementation pull request.
- Confirm every acceptance criterion maps to code and at least one appropriate
  test or an explicitly documented manual check.
- Require passing PR CI and Sonar Quality Gate and no unresolved high-severity
  security finding.
- Review migrations, authorization, privacy, accessibility, logging, and rollback
  in proportion to the feature's risk.

### 5. Validate in development

- Deploy through the protected development workflow.
- Exercise the primary user scenarios and failure states.
- Record the deployment run and product-owner acceptance as an agent-written
  comment on the feature issue when validation happens. The release-record
  pull request copies it into the feature document.
- Return to Design or Implement if behavior changes; do not edit acceptance
  history to make a failed implementation appear correct.

### 6. Release

- Merge the reviewed pull request.
- Apply migrations to development before production and follow their documented
  rollout order.
- Deploy production only with explicit approval.
- Record the production commit, deployment evidence, date, and known follow-up
  work. Mark the feature `Released` only after verification.

### 7. Change or retire

- Link follow-up issues and pull requests to the original feature record.
- Preserve accepted criteria and mark superseded behavior rather than deleting
  history.
- Append design changes with their reason and evidence. Use an ADR when the
  decision changes a boundary shared by multiple features.
- Mark retired features and document data migration or deletion effects.

## Statuses

Use one of: `Proposed`, `Designing`, `Accepted`, `Implementing`,
`Development validation`, `Released`, `Superseded`, or `Retired`.

## Traceability standard

The feature document is the navigation hub. Its traceability table must answer:

- Which accepted behavior is this?
- Where is it implemented?
- Which test proves it?
- Which pull request introduced or changed it?
- Where was it validated and released?

Source files should not carry issue-number comments solely for traceability. The
feature document, pull request, and Git history provide that linkage without
coupling implementation names to planning artifacts.

## Lightweight work

Routine dependency updates, refactoring with no behavior change, documentation
corrections, and small defects do not require a new feature design. Their issue or
pull request must still state the intent, risk, verification, and affected feature
documents. If product behavior, data ownership, or a durable design decision
changes, use the full feature workflow.
