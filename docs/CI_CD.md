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
explicit product-owner approval recorded before dispatch, and the owner's
approval of the run at the `production` environment gate; see
[ADR 0011](DECISIONS/0011-production-environment-required-reviewer.md).

Development and production jobs target different Wrangler environments and
therefore different Worker, D1, and R2 resources. The workflows do not create
resources. A failed quality gate, missing deployment credential, missing resource
ID, or missing confirmation prevents deployment. Missing Worker identity secrets
do not block Wrangler deployment but cause identity-dependent APIs to fail closed
at runtime; configure them before dispatch as described in
[environments](ENVIRONMENTS.md#phase-1-worker-configuration).

### Nutrition reference data

After migrations and before publishing, Deploy runs
`scripts/nutrition-dataset-load.ts --remote`, which loads the committed
`data/nutrition/usda-fdc.json` into the environment's D1 only when the
database doesn't already record that file's SHA-256
([ADR 0009](DECISIONS/0009-nutrition-reference-data.md)). It deletes the
version row first and writes it last, then checks the full-text index and the
counts; any failure stops the deploy before the Worker is published, and the
next deploy loads again. A load writes about 20,000 rows, within the free
plan's 100,000 a day. To change the dataset, run
`node scripts/nutrition-dataset-build.ts` in the Dev Container, review the
diff, and record the new version in the owning feature's decision log.

### AI proposals

Deploy adds the `AI` binding only to named environments. Before a development
validation of part B, create that environment's authenticated AI Gateway with
request logging off and configure its optional Gemini secrets as described in
[Environments](ENVIRONMENTS.md#ai-gateway-setup-for-recipe-nutrition). Workers
AI still runs when Gemini is not configured. The two model variables and
`GEMINI_FALLBACK` can disable either provider; when both are off, matching by
hand remains available. AI requests store no proposals, so reverting the
Worker version does not require a data rollback. Production retains its
previous Worker and migrations `0001`–`0005` until the owner's approval on
issue #84; its first approved deploy applies `0006` and loads the dataset
before publishing part B.

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
  a literal confirmation input, the owner's recorded approval, and the
  `production` environment's required-reviewer gate, which GitHub enforces.
- The protected workflow applies committed migrations immediately before the
  matching deployment. Owners must configure the environment credentials and
  review the target environment first; the workflow does not create resources.
- Rollback means redeploying a known-good Git revision; database forward recovery
  must be documented per migration.
