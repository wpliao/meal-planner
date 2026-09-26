# CI and delivery

## Pull-request quality gate

`.github/workflows/ci.yml` runs the same checks as `./scripts/verify.sh`
(formatting, linting, type checking, unit tests, Workers-runtime tests,
production build, and desktop/mobile browser tests) as parallel jobs on a
pinned `ubuntu-24.04` runner with Node 24 and pnpm 10:

- **Scope** classifies the change with `scripts/ci-scope.sh`. A pull request
  whose paths are all Markdown outside `.github/`, `src/`, `test/`, `tests/`,
  `scripts/`, `migrations/`, and `public/` is documentation only. A push to
  `main` is never documentation only.
- **Documentation format** runs `pnpm format:check` for a documentation-only
  pull request, and nothing else runs.
- **Static checks, unit and Worker tests** runs `./scripts/verify.sh
--no-e2e`, then Sonar analysis when `SONAR_TOKEN` is configured.
- **Browser tests** runs one job per Playwright project (`E2E_PROJECTS`):
  Chromium desktop with the asset-pipeline project, Chromium mobile, WebKit
  desktop, and WebKit mobile. Each installs only its browser and starts only
  its project's server.
- **Verify**, the one required status check, passes only when every job the
  change needs passed.

`./scripts/verify.sh` stays the single complete gate for Dev Containers,
Codespaces, and Deploy's fallback. `AGENTS.md` sets when agents run it locally.

The repository allows auto-merge and deletes head branches on merge. Sonar's
Quality Gate is required by the definition of done.

## Deployments

Deployment is intentionally manual. `.github/workflows/deploy.yml` accepts a
target environment, reuses CI's result for the exact commit (see below), builds the matching
Wrangler environment, applies pending D1 migrations remotely, and deploys with
the matching GitHub environment credentials. Production additionally requires
the literal confirmation input, the `main`-only GitHub environment branch policy,
and explicit product-owner approval recorded before dispatch. This private
GitHub Pro repository cannot configure required environment reviewers; see
[ADR 0005](DECISIONS/0005-production-deployment-approval-on-github-pro.md).

Development and production jobs target different Wrangler environments and
therefore different Worker, D1, and R2 resources. The workflows do not create
resources. A failed quality gate, missing deployment credential, missing resource
ID, or missing confirmation prevents deployment. Missing Worker identity secrets
do not block Wrangler deployment but cause identity-dependent APIs to fail closed
at runtime; configure them before dispatch as described in
[environments](ENVIRONMENTS.md#phase-1-worker-configuration).

### Reusing CI's verification

Development deploys only from `main`, and every push to `main` runs the full
CI gate. Before building, Deploy runs `scripts/ci-verified.sh`: when the CI
workflow's push run for the deployed commit succeeded, the full gate is not run
again. While that run is still in progress, Deploy waits for up to 20 minutes.
If the run is missing, failed, was cancelled, or is still running at the
deadline, or GitHub's API fails, Deploy installs the test browsers and runs
`./scripts/verify.sh` itself, as it always did. A failed gate still prevents
migration and deployment.

## Household decommission

`.github/workflows/household-decommission.yml` is a separate, manually
dispatched operator workflow that deletes the one installed household from an
environment's live D1 database. It has no automatic trigger, reads only
`contents`, shares the `cloudflare-<environment>` concurrency group with
Deploy so the two never overlap, and is dispatchable for
development from `main` only. It uses a dedicated
`CLOUDFLARE_DECOMMISSION_API_TOKEN` environment secret that the owner creates
for a planned run. It refuses to touch D1 unless Access and the Worker route
are already closed. Production is not eligible: its job always fails before
any credentialed step. Follow the
[household decommission runbook](operations/household-decommission.md).

## Release policy

- Pull requests never deploy production.
- A production deploy is tied to a reviewed Git commit, a `main`-only environment,
  a literal confirmation input, and the owner's recorded approval. These process
  and workflow controls are not equivalent to an enforced reviewer gate.
- The protected workflow applies committed migrations immediately before the
  matching deployment. Owners must configure the environment credentials and
  review the target environment first; the workflow does not create resources.
- Rollback means redeploying a known-good Git revision; database forward recovery
  must be documented per migration.
