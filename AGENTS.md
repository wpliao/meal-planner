# Engineering instructions

This file is the authoritative working agreement for every coding agent and
human contributor. Read it before changing the repository. Also read the issue,
pull request, recent `git log`, current `git status`/diff, relevant architecture
documents, and available CI and Sonar results.

## Product and scope

This is a private family meal-planning web application. The product direction is
in `docs/PRODUCT.md`. Phase 0 is complete. Do not add pantry, recipe, nutrition,
image analysis, AI, or meal-planning features unless an accepted feature issue
and its design document explicitly ask for them.

## Architecture

- React and TypeScript render a responsive browser client.
- Vite and `@cloudflare/vite-plugin` develop and build the client and Worker as
  one deployable Cloudflare Worker with Static Assets.
- `src/worker/index.ts` handles `/api/*`; static requests are handled by the
  Vite/Cloudflare asset pipeline.
- D1 is the future system of record for structured data. R2 is reserved for
  binary objects such as user-supplied images. The bindings exist now, but no
  product schema or object workflow exists in Phase 0.
- Cloudflare Access will be the perimeter authentication layer. Application code
  must still validate authorization assumptions and never trust client input.
- External AI must be behind a provider abstraction and AI Gateway. Nutritional
  values must come from structured data, never invented model output.
- Local, development, and production are separate environments. Development and
  production must never share D1 databases or R2 buckets.

See `docs/ARCHITECTURE.md` and `docs/DECISIONS/` before changing these choices.

## Repository layout

```text
src/client/           React application and browser-facing code
src/shared/           Runtime-neutral contracts shared by client and Worker
src/worker/           Cloudflare Worker entry point and API code
tests/e2e/            Playwright browser tests
docs/                 Product and engineering documentation
docs/features/        Versioned feature designs and traceability records
migrations/           Ordered, immutable D1 migrations
data/                 Committed reference data, such as the USDA nutrition dataset
scripts/              Cross-environment repository scripts
.github/workflows/    CI and manually gated deployments
.devcontainer/        Reproducible development environment
```

## Feature lifecycle and traceability

Follow `docs/FEATURE_LIFECYCLE.md` for every product feature. The GitHub issue is
the canonical statement of intent; its versioned design lives in
`docs/features/<issue-number>-<slug>.md`. Do not begin feature implementation
until both exist and the design status is `Accepted`.

- Give every acceptance criterion a stable identifier such as `AC-01`. Do not
  silently renumber or delete accepted criteria; mark changed criteria and record
  the reason.
- Keep the feature document's traceability table current. Map each criterion to
  implementation files or named symbols, exact automated test files and test
  names, and release evidence when available.
- Update the design document in the same pull request whenever behavior or design
  changes. Append the change to its decision log. Add or supersede an ADR when a
  change affects durable architecture across features.
- Link the issue, design document, pull request, migrations, CI/Sonar results,
  development validation, and production release so a successor can reconstruct
  the feature without conversation history.
- Bugs, dependency updates, and repository maintenance may use a lighter issue or
  pull request record when no product behavior or durable design changes.

When using multiple agents, follow `docs/AGENT_ORCHESTRATION.md`. Coordinate
shared-worktree stages explicitly, keep overlapping files under one owner, and
require the root agent to review and integrate every delegated result.

## Development commands

Use pnpm only. Do not hand-edit `pnpm-lock.yaml`.

- `pnpm run setup`: reproducible dependency and Playwright Chromium installation.
- `pnpm install --frozen-lockfile`: install locked JavaScript dependencies only.
- `pnpm dev`: full local Vite + Worker development server.
- `pnpm build`: production build.
- `pnpm lint` / `pnpm format:check` / `pnpm typecheck`: static checks.
- `pnpm test`: client/unit and Worker runtime tests.
- `pnpm test:e2e`: Playwright browser tests.
- `./scripts/verify.sh`: the complete quality gate. CI's required `Verify`
  check runs the same steps as parallel jobs (`--no-e2e`, then one browser
  project per job via `E2E_PROJECTS`).
- `pnpm cf:typegen`: regenerate `worker-configuration.d.ts` after binding changes.

## Testing requirements

Add the lowest-cost test that proves each behavior, then add integration or E2E
coverage where a boundary is important. Worker APIs require tests in the actual
Workers runtime. Critical user journeys require Playwright. Tests must be
deterministic, isolated, and independent of paid or remote services. Never delete,
skip, or weaken a test merely to make CI pass.

CI's `Verify` check is the authoritative full gate. While working, run the
checks and tests relevant to the change locally: lint, typecheck, the affected
unit and Workers-runtime tests, and the affected Playwright specs. Run the full
`./scripts/verify.sh` locally before opening a large implementation pull
request, or whenever CI cannot run. Completion requires a successful build,
typecheck, lint, format check, unit tests, relevant Worker integration tests,
relevant E2E tests, a passing `Verify` check, and (once configured) a passing
Sonar Quality Gate. There must be no known unresolved high-severity security
issue.

A pull request that changes only documentation Markdown (see
`scripts/ci-scope.sh`) runs the format check alone in CI; run
`pnpm format:check` locally. Pushes to `main` always run every check.

## Git workflow

- Start from an up-to-date branch and keep changes focused on one issue.
- Use branches prefixed `codex/` for Codex work and `claude/` for Claude Code
  work unless the product owner specifies otherwise.
- Do not rewrite or discard user work. Preserve reasonable existing approaches;
  preference alone is not a reason to rewrite another agent's implementation.
- Use clear commits that explain intent. Reference the issue in the PR.
- Do not force-push, merge, deploy, or modify production without explicit
  authorization. The owner merges design, code, tooling, and process pull
  requests, usually by enabling auto-merge so the pull request merges itself
  when `Verify` passes.
- Standing authorization (owner, 2026-09-26, issue #86): an agent may merge a
  pull request that only records a feature's development validation or
  production release in documentation, once `Verify` passes.
- Pull requests are squash-merged, and GitHub deletes the head branch on
  merge.
- PRs must describe behavior, design decisions, migration impact, security impact,
  verification evidence, and follow-up work.

## Security rules

- Never commit credentials, tokens, API keys, private data, `.dev.vars`, or local
  database/object-store state. Keep examples obviously fake.
- Treat all browser and AI input as untrusted. Validate at API boundaries and do
  not put secrets in `VITE_*` variables.
- Use least-privilege Cloudflare and GitHub credentials. Production secrets and
  resources are distinct from development.
- Avoid logging personal meal data, access assertions, uploaded image contents,
  or secrets. Apply retention limits to future family data and uploads.
- Review dependencies and CI action provenance. Pin release versions or commit
  SHAs in delivery workflows where practical.
- Follow `docs/SECURITY.md`; report suspected credential exposure immediately.

## Database migration rules

- Every D1 schema change is an ordered SQL file in `migrations/` committed to Git.
- Never modify production schema manually and never edit an already-applied
  migration. Add a forward migration instead.
- Use sortable numeric names such as `0001_create_example.sql`.
- Make migrations safe for the supported rollout order. Document destructive or
  data-rewriting operations and provide backup/rollback guidance.
- Test migrations locally and in development before production. Production
  application requires explicit approval through the protected environment.

## Definition of done

Work is done only when implementation, tests, documentation, migrations, and
tooling are consistent; the PR's `Verify` check and enabled Sonar Quality Gate
pass; security review has no unresolved high-severity finding; and
the PR explains manual configuration or deployment steps. For a product feature,
all acceptance criteria must also be mapped to implementation and passing tests
in its feature document, and the decision and release logs must be current. A
local pass does not substitute for required remote gates.

## Agent handoff

Before handing off:

1. Leave the worktree coherent; do not hide important state outside Git.
2. Record the issue/goal, completed work, decisions, files changed, commands run
   and exact results, known failures, migration/deployment state, and next action
   in the PR or issue.
3. Update architecture/ADR documentation when a durable decision changed.
4. Show `git status` and preserve unrelated changes.
5. Never claim a check passed unless it ran. Distinguish failures caused by code,
   missing local tooling, missing credentials, or external services.

A successor should be able to resume using this file, the issue and PR, Git
history/status/diff, documentation, CI, and Sonar—not conversation history.
