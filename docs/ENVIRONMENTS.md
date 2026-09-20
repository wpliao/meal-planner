# Environments

## Separation

| Level       | Worker                            | D1 database                   | R2 bucket                             | Purpose                                     |
| ----------- | --------------------------------- | ----------------------------- | ------------------------------------- | ------------------------------------------- |
| Local       | Vite + local workerd              | Local Miniflare D1            | Local Miniflare R2                    | Fast, offline-capable development and tests |
| Development | `family-meal-planner-development` | `family-meal-planner-dev-d1`  | `family-meal-planner-dev-uploads-r2`  | Integration and family acceptance           |
| Production  | `family-meal-planner-production`  | `family-meal-planner-prod-d1` | `family-meal-planner-prod-uploads-r2` | Stable family application                   |

Wrangler bindings are non-inheritable, so `wrangler.jsonc` repeats variables,
D1, and R2 for each named environment. This makes accidental sharing visible.

## Local

Use the Dev Container or Node 24 and pnpm 10. Dev Containers and GitHub
Codespaces run `pnpm run setup` automatically during creation. For a native setup,
run `pnpm run setup` yourself. This installs the locked packages and the Chromium
binary required by Playwright. Optionally copy `.dev.vars.example` to
`.dev.vars`, then run `pnpm dev`. The local adapter does not require live Access
secrets. The development command applies pending migrations to the local D1
database before starting Vite. Local D1/R2 state is stored under ignored
`.wrangler/` paths.

## One-time Cloudflare setup

An authorized owner must:

1. Confirm the separate development and production D1 databases and R2 buckets
   with the exact names in the table above.
2. Keep the real, non-secret D1 resource IDs in `wrangler.jsonc` and keep the
   distinct bucket names. The configured D1 IDs are development
   `5f5e98ba-7b27-4fcf-8c2b-ab1605461082` and production
   `d944b652-580f-437e-b7ce-21818525c46c`.
3. Configure Cloudflare Access applications/policies independently for both
   deployed hostnames before personal data is exposed.
4. Create least-privilege GitHub environments named `development` and
   `production`; require reviewers on `production`.
5. Add scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets to each
   GitHub environment. Do not reuse a broad personal global API key.
6. Add custom domains/routes only after reviewing Access and DNS configuration.

Creating resources, adding credentials, and deploying are manual owner actions;
the scaffold does none of them automatically.

## Commands

The protected deployment workflow selects the named environment, runs the full
verification gate, builds the matching configuration, applies pending committed
D1 migrations to that environment, and deploys. Owners do not need to run a
separate remote migration command. Review the target environment and configure
its credentials first; production still requires explicit confirmation and the
protected `production` environment approval.

For local inspection, `CLOUDFLARE_ENV=development pnpm build` selects the named
configuration. Never use a development command against the production database.

## Phase 1 Worker configuration

The named `development` and `production` environments each require these
encrypted Worker secrets:

- `CF_ACCESS_AUD`: the Cloudflare Access application's **Application Audience
  (AUD) tag**, not the Access application ID. Development and production must
  use different audience tags.
- `BOOTSTRAP_OWNER_EMAIL`: the exact verified email allowed to create the first
  household owner in that environment. Keep development and production values
  intentionally scoped and do not put them in `VITE_*` variables.

The non-secret team-domain URL is configured per environment. Local development
uses the deterministic local identity and does not need a live Access JWT. Do
not commit `.dev.vars`; use `.dev.vars.example` only as a names-only template.

Set each value through an authenticated Wrangler session, entering the value at
the prompt so it does not appear in shell history:

```sh
pnpm wrangler secret put CF_ACCESS_AUD --env development
pnpm wrangler secret put BOOTSTRAP_OWNER_EMAIL --env development
pnpm wrangler secret put CF_ACCESS_AUD --env production
pnpm wrangler secret put BOOTSTRAP_OWNER_EMAIL --env production
```

Configure and validate development first. Do not set the production values or
run the production workflow until production rollout is explicitly approved.

Before deployment, verify the environment's Worker, D1 database, R2 bucket,
Access application/policy, audience tag, and bootstrap secret all belong to the
same environment. The workflow applies `0001_create_household_identity.sql`
when pending. Record the migration and deployment result in the Phase 1 feature
document.
