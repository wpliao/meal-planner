# Phase 1 agent orchestration strategy

**Approved:** 2026-09-20

**Scope:** Phase 1 implementation and verification

This document records the product owner's approved strategy for using multiple
Codex agents during Phase 1. It supplements the repository working agreement;
it does not change feature scope, approval gates, or the definition of done.

## Roles and model allocation

The root agent is the orchestrator and remains on GPT-5.6 Sol with high
reasoning effort. It owns the complete product and design context, integration
decisions, Git workflow, feature traceability, and final verification.

Subtasks may use the following explicitly selected model and effort:

| Responsibility                                                | Model and effort     | Operating mode                                                                          |
| ------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| Worker/D1 implementation and other security-sensitive changes | GPT-5.6 Sol, high    | Changes are focused and coordinated by the root agent.                                  |
| Independent security and authorization review                 | GPT-6 Astra, high    | Read-only review of authentication, household isolation, migrations, and related risks. |
| Frontend and accessibility implementation                     | GPT-5.6 Terra, high  | Starts after shared API and type contracts stabilize.                                   |
| Narrow repetitive documentation or traceability checks        | GPT-5.6 Luna, medium | Limited to well-defined, low-ambiguity documentation tasks.                             |

Model descriptions and supported reasoning levels should be confirmed against
the [official OpenAI model catalog](https://developers.openai.com/api/docs/models)
before each future implementation cycle. See also the [official Codex subagent
guidance](https://developers.openai.com/docs/agent-configuration/subagents)
for delegation and configuration behavior.

## Staged execution

Agents work in stages with explicit handoffs, not as overlapping authors of the
same implementation files:

1. Sol High establishes the Worker/D1 boundary and shared contracts.
2. Terra High implements the client and accessibility coverage once those
   contracts are stable.
3. Astra High performs an independent, read-only security review.
4. Sol High integrates findings, updates the feature traceability record, and
   runs the complete verification and release-readiness checks.

The root agent reviews every subagent result and decides whether it is accepted,
requires revision, or changes the design. Subagents should return focused
summaries with changed files, decisions, tests, and unresolved risks rather than
unfiltered working output.

## Repository and approval boundaries

- Shared-worktree edits must be coordinated to avoid concurrent changes to the
  same files. A later stage may begin only when its required contracts or
  handoff are stable.
- Delegation does not broaden permissions. Subagents inherit the applicable
  sandbox and repository controls, and a read-only review remains read-only.
- Production migrations, deployments, merges, and other protected operations
  retain their existing explicit approval requirements.
- The root agent remains accountable for the final code, design and decision
  log, acceptance-criterion traceability, migration safety, and release record.

## Verification requirement

Delegation does not reduce the quality bar. The root agent must review all
outputs and ensure that `./scripts/verify.sh`, relevant Worker and E2E tests,
CI, and the Sonar Quality Gate (once configured) pass, with no unresolved
high-severity security finding. Exact commands and results belong in the
feature record or pull request according to
[`docs/FEATURE_LIFECYCLE.md`](FEATURE_LIFECYCLE.md).

This allocation is a starting strategy, not a permanent capability guarantee.
At the beginning of each future cycle, re-check model availability, supported
reasoning efforts, account limits, and current OpenAI guidance before assigning
subtasks.
