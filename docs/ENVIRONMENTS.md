# Environments

## Separation

| Level       | Worker                            | D1 database                   | R2 bucket                             | Purpose                                     |
| ----------- | --------------------------------- | ----------------------------- | ------------------------------------- | ------------------------------------------- |
| Local       | Vite + local workerd              | Local Miniflare D1            | Local Miniflare R2                    | Fast, offline-capable development and tests |
| Development | `family-meal-planner-development` | `family-meal-planner-dev-d1`  | `family-meal-planner-dev-uploads-r2`  | Integration and family acceptance           |
| Production  | `family-meal-planner-production`  | `family-meal-planner-prod-d1` | `family-meal-planner-prod-uploads-r2` | Stable family application                   |

Wrangler bindings are non-inheritable, so `wrangler.jsonc` repeats variables,
D1, and R2 for each named environment. This makes accidental sharing visible.
The `AI` binding and gateway/model variables exist only in the two named
environments. Local has no AI binding or Gemini secret and always uses the
deterministic fake.

## AI Gateway setup for recipe nutrition

Do these steps in a phone browser for **development first**, then repeat with
separate production resources before the approved production release:

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), select the
   correct account. Open **AI > AI Gateway > Create Gateway**. Create
   `family-meal-planner-development` or `family-meal-planner-production`,
   matching `AI_GATEWAY_ID` in `wrangler.jsonc`. In that gateway's **Settings**,
   turn **Authenticated Gateway** on. Turn **Request logging** off; keep
   analytics. Do not enable stored provider keys or unified billing.
2. In the gateway's Settings, tap **Create authentication token** with
   **AI Gateway Run** permission and copy it to a password manager. The token
   is shown only once. Use a separate token for each environment. The token
   is account-scoped, so keep its access limited. Workers AI's binding is
   preauthenticated; this token is used for the Gemini gateway request.
3. In [Google AI Studio API keys](https://aistudio.google.com/app/apikey),
   select or create a Google Cloud project **without billing**, then create a
   Gemini API key. Use a different no-billing project and key for production.
   Do not paste either key into GitHub, an issue, a PR, or chat. The configured
   free-tier model is `gemini-3.5-flash-lite`.
4. In Cloudflare, copy the account ID from the account overview. Open
   **Workers & Pages > family-meal-planner-development > Settings > Variables
   and Secrets**. Add these as encrypted **Secret** bindings:
   `AI_GATEWAY_ACCOUNT_ID` (the account ID), `AI_GATEWAY_TOKEN` (step 2), and
   `GEMINI_API_KEY` (step 3). Repeat for the production Worker only when its
   rollout is approved. These are optional at deployment: Workers AI works
   alone until all three Gemini values are set. Never add them as `VITE_*`
   variables or plaintext bindings.

The dashboard can add Worker secrets after the first deployment. The
development Worker must be deployed from merged `main` before its new `AI`
binding and gateway variables exist. For validation, set `WORKERS_AI_MODEL`
to `off` in the development Worker's variables to force Gemini, then restore
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Set `GEMINI_FALLBACK=off` as
well to check the unavailable path, then restore `on`. Review each dashboard
change's resulting Worker version; never make these changes in production
without the owner's explicit approval.

## Local

Use the Dev Container or Node 24 and pnpm 10. Dev Containers and GitHub
Codespaces run `pnpm run setup` automatically during creation. For a native setup,
run `pnpm run setup` yourself. This installs the locked packages and the
Chromium and WebKit browsers required by Playwright. WebKit needs system
libraries that `playwright install --with-deps` adds as root, so the Dev
Container is the supported way to run the complete browser suite; an
environment without root can run the Chromium projects only. Optionally copy `.dev.vars.example` to
`.dev.vars`, then run `pnpm dev`. The local adapter does not require live Access
secrets. The development command applies pending migrations to the local D1
database before starting Vite. Local D1/R2 state is stored under ignored
`.wrangler/` paths.

## One-time Cloudflare setup

An authorized owner must:

1. Confirm the separate development and production D1 databases and R2 buckets
   with the exact names in the table above.
2. Keep the real, non-secret D1 resource IDs in `wrangler.jsonc` and keep the
   distinct bucket names. `wrangler.jsonc` is the only place in the
   repository that records the D1 IDs; documentation and tests refer to it
   rather than repeating them.
3. Configure Cloudflare Access applications/policies independently for both
   deployed hostnames before personal data is exposed.
4. Create least-privilege GitHub environments named `development` and
   `production`, and restrict production deployments to `main`. Required
   environment reviewers are unavailable for this private GitHub Pro repository;
   see [ADR 0005](DECISIONS/0005-production-deployment-approval-on-github-pro.md).
5. Add scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets to each
   GitHub environment. Do not reuse a broad personal global API key.
6. Add custom domains/routes only after reviewing Access and DNS configuration.

Creating resources and adding credentials are manual owner actions; the scaffold
does none of them automatically. Production deployment requires the owner's
explicit recorded approval before an authorized operator dispatches the workflow.

## Commands

The protected deployment workflow selects the named environment, runs the full
verification gate, builds the matching configuration, applies pending committed
D1 migrations to that environment, and deploys. Owners do not need to run a
separate remote migration command. Review the target environment and configure
its credentials first; production requires the literal workflow confirmation,
the `main`-only environment branch policy, and the owner's recorded approval.

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

When using the Cloudflare dashboard, select type **Secret** for both bindings.
Do not use Text or Plaintext: Wrangler may print plaintext values while comparing
dashboard and repository configuration, and a later deploy may overwrite them.
Encrypted secrets stay hidden and are preserved across ordinary deployments.

Set each value through an authenticated Wrangler session, entering the value at
the prompt so it does not appear in shell history:

```sh
pnpm wrangler secret put CF_ACCESS_AUD --env development
pnpm wrangler secret put BOOTSTRAP_OWNER_EMAIL --env development
pnpm wrangler secret put CF_ACCESS_AUD --env production
pnpm wrangler secret put BOOTSTRAP_OWNER_EMAIL --env production
```

Set both values **before** running the deployment workflow. The
`secrets.required` list in `wrangler.jsonc` drives type generation and local
development warnings; it does **not** block a deploy whose secrets are unset. A
deploy without them succeeds and then fails closed at runtime, returning `503`
from every identity-dependent API until the secrets exist.

The top-level Wrangler configuration is deliberately not publishable
(`workers_dev` and `preview_urls` are `false`) because it selects the
deterministic local identity adapter. Always deploy through the workflow, which
sets `CLOUDFLARE_ENV` for the named environment.

Configure and validate development first. Do not set the production values or
run the production workflow until production rollout is explicitly approved.

Before deployment, verify the environment's Worker, D1 database, R2 bucket,
Access application/policy, audience tag, and bootstrap secret all belong to the
same environment. The workflow applies `0001_create_household_identity.sql`
when pending. Record the migration and deployment result in the Phase 1 feature
document.
