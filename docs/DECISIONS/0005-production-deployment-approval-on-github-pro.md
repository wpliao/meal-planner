# ADR 0005: Production deployment approval on private GitHub Pro

- Status: Accepted
- Date: 2026-09-21
- Supersedes: The required-reviewer clause of [ADR 0002](0002-environment-isolation.md)

## Context

ADR 0002 called for required reviewers on the production GitHub environment.
GitHub's [environment documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#required-reviewers)
states that required environment reviewers on GitHub Pro are available only for
public repositories. This repository is private. The production environment's
API configuration confirms a branch policy but no required-reviewer rule.

## Decision

Keep development and production credentials and resources separate. Restrict the
production GitHub environment to `main`, require the deployment workflow's exact
`DEPLOY_PRODUCTION` confirmation input, and record explicit product-owner
approval in the relevant release or feature issue before an authorized operator
dispatches a production run. Phase 1 approval is recorded in
[issue #7](https://github.com/wpliao/meal-planner/issues/7#issuecomment-5755201106).
The workflow must pass the full verification gate, production
build, and remote D1 migrations before deploying the Worker. Do not represent
this process as a GitHub-enforced second-person review.

If the repository later gains a plan and ownership setup that supports required
reviewers for private environments, configure that stronger gate and update this
decision and delivery documentation.

## Consequences

The Phase 1 production release can use the existing private GitHub Pro
repository without making it public or purchasing a different plan. GitHub
enforces the branch restriction and confirmation step, while owner approval is
a recorded process requirement rather than a technical reviewer gate. Anyone
with sufficient repository workflow/deployment privileges could bypass that
process; keep those privileges narrow and audit production workflow runs.
