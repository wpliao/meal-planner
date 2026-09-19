# ADR 0003: Repository-centered feature traceability

- Status: Accepted
- Date: 2026-09-19

## Context

Product features will evolve across multiple agents, pull requests, environments,
and releases. Conversation history is not a durable project record, and code or
tests alone do not explain which user outcome they implement. Issue links without
stable acceptance criteria also become ambiguous when behavior or design changes.

## Decision

Use the GitHub feature issue as the canonical statement of intent and keep a
versioned feature design under `docs/features/`. Give accepted criteria stable
`AC-*` identifiers. Maintain a traceability table from each criterion to named
implementation and test locations plus release evidence. Update the design and
append its decision log in the same pull request as a behavior change. Use ADRs
for decisions that cross feature boundaries.

Do not add issue-number comments throughout source code solely for traceability.
Repository links, named symbols and tests, pull requests, and Git history provide
the connection without coupling source text to planning identifiers.

## Consequences

Feature work has a small documentation cost before and during implementation.
In return, contributors can reconstruct why behavior exists, which tests prove
it, and where it was released without relying on an agent conversation. Routine
maintenance may use a lighter record when product behavior and durable design do
not change.
