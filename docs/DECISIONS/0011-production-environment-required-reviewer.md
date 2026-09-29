# ADR 0011: Production environment required reviewer on the public repository

- Status: Accepted
- Date: 2026-09-29
- Supersedes: [ADR 0005](0005-production-deployment-approval-on-github-pro.md)
- Issue: [#106](https://github.com/wpliao/meal-planner/issues/106)
- Configured by the product owner: 2026-09-29, recorded on
  [#106](https://github.com/wpliao/meal-planner/issues/106)

## Context

ADR 0005 accepted a process-only production approval because required
environment reviewers on GitHub Pro are available only for public
repositories, and this repository was private. On 2026-09-29 the owner made the
repository public after the security sweep recorded in #106 and pull request
#107. That removed the constraint ADR 0005 worked around, so the stronger gate
that [ADR 0002](0002-environment-isolation.md) originally called for is now
available.

## Decision

The `production` GitHub environment requires a reviewer (`wpliao`) before any
job that targets it may start. Self-review is allowed because the owner is the
only collaborator; if a second person gains write access, turn on **Prevent
self-review** and add them as a reviewer. The `main`-only branch policy, the
literal `DEPLOY_PRODUCTION` confirmation input, and the recorded owner approval
in the release or feature issue all remain in force. GitHub now enforces the
approval step in addition to recording it.

The `development` environment keeps its branch policy only, with no required
reviewer. It is the rehearsal environment: its destructive workflows already
require dispatch from `main` plus a typed confirmation, refuse production in
code, and dispatching any workflow needs write access regardless of repository
visibility.

The repository also requires commit-SHA pinning for every action, approves
workflow runs from all outside contributors' fork pull requests manually, and
has secret scanning with push protection enabled.

## Consequences

A production Deploy run pauses at the environment gate until the reviewer
approves it in the Actions UI. Approving the run is the recorded owner
approval's technical counterpart, not a replacement for it: the release or
feature issue still records why the release was approved. Documentation that
described the private-repository limitation is updated in the same change as
this record; ADR 0005 stays for history and is marked superseded.
