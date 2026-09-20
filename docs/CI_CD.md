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
the literal confirmation input and must have required reviewers configured on
the GitHub `production` environment.

Development and production jobs target different Wrangler environments and
therefore different Worker, D1, and R2 resources. The workflows do not create
resources. A failed quality gate, missing secret, missing resource ID, or missing
approval prevents deployment.

## Release policy

- Pull requests never deploy production.
- A production deploy is tied to a reviewed Git commit and protected environment.
- The protected workflow applies committed migrations immediately before the
  matching deployment. Owners must configure the environment credentials and
  review the target environment first; the workflow does not create resources.
- Rollback means redeploying a known-good Git revision; database forward recovery
  must be documented per migration.
