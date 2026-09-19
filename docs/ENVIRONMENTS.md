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

Use the Dev Container or Node 24 and pnpm 10. Run `pnpm install`, optionally copy
`.dev.vars.example` to `.dev.vars`, then run `pnpm dev`. Phase 0 needs no secrets.
Local D1/R2 state is stored under ignored `.wrangler/` paths.

## One-time Cloudflare setup

An authorized owner must:

1. Create separate development and production D1 databases and R2 buckets with
   the exact names in the table above.
2. Record the real, non-secret D1 resource IDs in `wrangler.jsonc` and keep the
   distinct bucket names.
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

Use `CLOUDFLARE_ENV=development pnpm build` with the Vite plugin to select a
named environment at build time, then run `pnpm wrangler deploy`; Wrangler uses
the generated deployment configuration in `dist`. Do this only through the
documented workflow. Substitute `production` only after explicit production
approval. Apply future migrations to development first.
