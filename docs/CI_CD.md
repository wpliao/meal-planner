# CI and delivery

## Pull-request quality gate

`.github/workflows/ci.yml` installs the lockfile with Node 24/pnpm 10, installs a
Chromium test browser, and runs `./scripts/verify.sh`. That script is the single
shared gate for local agents, Dev Containers, Codespaces, and CI: formatting,
linting, type checking, unit tests, Workers-runtime tests, production build, and
desktop/mobile browser tests.

Sonar analysis runs when `SONAR_TOKEN` is configured. Once enabled for the private
repository, the Sonar Quality Gate is required by the definition of done and
should be configured as a required GitHub status check.

## Deployments

Deployment is intentionally manual. `.github/workflows/deploy.yml` accepts a
target environment, re-runs the common verification gate, builds the matching
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
