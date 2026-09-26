# Agent orchestration strategy

**Approved:** 2026-09-20 (Phase 1, Codex only)

**Revised:** 2026-09-24 — extended to all phases and to both Codex and Claude
Code, with the GPT-6 and current Claude model generations; approved by the
product owner.

**Scope:** implementation and verification work that uses more than one agent

This document records the product owner's approved strategy for using multiple
agents in Codex or Claude Code. It supplements the repository working agreement;
it does not change feature scope, approval gates, or the definition of done.

## Roles

The **root agent** is the orchestrator. It owns the complete product and design
context, integration decisions, Git workflow, feature traceability, and final
verification. It may delegate to these roles:

- **Implementer:** Worker/D1 implementation and other security-sensitive
  changes, focused and coordinated by the root agent.
- **Security reviewer:** independent, read-only review of authentication,
  household isolation, migrations, and related risks.
- **Frontend implementer:** client and accessibility implementation, started
  after shared API and type contracts stabilize.
- **Documentation checker:** narrow, well-defined, low-ambiguity documentation
  or traceability checks.

## Model allocation

| Role                  | Codex (GPT-6)      | Claude Code           |
| --------------------- | ------------------ | --------------------- |
| Root orchestrator     | GPT-6 Sol, high    | Claude Opus 5.5, high |
| Implementer           | GPT-6 Sol, high    | Claude Opus 5.5, high |
| Security reviewer     | GPT-6 Astra, high  | Claude Opus 5.5, max  |
| Frontend implementer  | GPT-6 Sol, medium  | Claude Sonnet 5, high |
| Documentation checker | GPT-6 Luna, medium | Claude Sonnet 5, low  |

Each entry is a model and its reasoning effort. Use the column for the tool
running the root agent. Available models depend on the owner's subscription;
when a listed model is unavailable, use the closest available model, and record
the substitution in the pull request.

The Claude Code security reviewer uses the same model as the implementer, so its
independence comes from its setup: it runs at a higher effort, read-only, in a
fresh subagent that receives the diff, the feature document, and `AGENTS.md`
rather than the implementer's working context.

## Staged execution

Agents work in stages with explicit handoffs, not as overlapping authors of the
same implementation files:

1. The implementer establishes the Worker/D1 boundary and shared contracts.
2. The frontend implementer builds the client and accessibility coverage once
   those contracts are stable.
3. The security reviewer performs an independent, read-only review.
4. The root agent integrates findings, updates the feature traceability record,
   and runs the complete verification and release-readiness checks.

The root agent reviews every subagent result and decides whether it is accepted,
requires revision, or changes the design. Subagents should return focused
summaries with changed files, decisions, tests, and unresolved risks rather than
unfiltered working output.

## Tool-specific configuration

Both tools load `AGENTS.md` as project instructions, so the working agreement
needs no tool-specific copy.

- **Claude Code** sets a subagent's model and effort with the `model` and
  `effort` fields of a `.claude/agents/<name>.md` definition, or per request. A
  read-only reviewer is limited to read-only tools. See the [Claude Code subagent
  documentation](https://code.claude.com/docs/en/sub-agents) and [model
  configuration](https://code.claude.com/docs/en/model-config).
- **Codex** sets them with the `model` and `model_reasoning_effort` fields of a
  `.codex/agents/<name>.toml` definition, `[agents]` defaults, or per request. A
  read-only reviewer uses `sandbox_mode = "read-only"`. See the [Codex subagent
  documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).
- Effort names differ between tools. Claude Code uses `low` through `max`; Codex
  also offers `none` and `ultra`. Do not use Codex `ultra`: it delegates to its
  own parallel subagents, which bypasses the root agent's staged, single-owner
  control of files.

## Working across tools

- One tool owns a worktree at a time. Codex and Claude Code never edit the same
  checkout concurrently.
- Hand work between tools through a pushed branch or pull request, never through
  uncommitted state.
- Optionally, the other tool's security reviewer may review the pull request,
  for example GPT-6 Astra reviewing Claude-authored changes or Claude Opus 5.5
  reviewing Codex-authored changes. This adds a different model family where the
  risk justifies it; it remains read-only and does not replace the primary
  review.
- Branches use the prefix of the tool that authored them: `codex/` for Codex and
  `claude/` for Claude Code.

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
outputs and ensure that the relevant Worker and E2E tests, CI's `Verify`
check (the full gate, as in `./scripts/verify.sh`), and the Sonar Quality Gate
(once configured) pass, with no unresolved
high-severity security finding. Exact commands and results belong in the
feature record or pull request according to
[`docs/FEATURE_LIFECYCLE.md`](FEATURE_LIFECYCLE.md). The pull request handoff
also records the tool, model, and effort used for each stage.

This allocation is a starting strategy, not a permanent capability guarantee.
At the beginning of each implementation cycle, re-check model availability,
supported reasoning efforts, subscription and account limits, and current
guidance in the [Codex model catalog](https://learn.chatgpt.com/docs/models),
the [OpenAI model catalog](https://developers.openai.com/api/docs/models), and
the [Claude model overview](https://platform.claude.com/docs/en/models/overview)
before assigning subtasks.
