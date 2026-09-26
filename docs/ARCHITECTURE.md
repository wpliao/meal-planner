# Architecture

## Current system

The repository produces one Cloudflare Worker deployment. Vite builds the React
client as Static Assets and bundles the Worker API. During development,
`@cloudflare/vite-plugin` runs both through one origin, so local behavior closely
matches deployment and does not need a separate CORS-enabled API server.

```text
Browser / installable web app
          |
          | same-origin HTTPS
          v
Cloudflare Access (development/production perimeter)
          |
          v
Worker routes /api/*  +  Static Assets routes
          |                         |
          +---- D1 (structured)     +---- React client
          +---- R2 (binary, future)
```

The Worker validates Cloudflare Access application JWTs (or uses a deterministic
local identity adapter) and rechecks active D1 membership on protected requests.
D1 now holds household, pantry, recipe, meal-plan, and confirmed nutrition data,
plus shared USDA reference foods. R2 remains reserved for future binary objects.
Recipe nutrition proposals use a Worker-side provider interface: Workers AI runs
through the environment's AI Gateway first, then Gemini through that gateway
when enabled. Local development uses a deterministic fake. Proposals are
ephemeral; confirmed matches and USDA data alone determine nutrition totals
([ADR 0010](DECISIONS/0010-ai-provider-boundary.md)).

## Code boundaries

- `src/client` may use browser APIs and communicates with the Worker over
  same-origin HTTP. It must not know cloud credentials.
- `src/worker` runs in the Cloudflare Workers runtime. API input is untrusted and
  future endpoints must validate it before domain or persistence work.
- `src/shared` contains runtime-neutral contracts only. Do not import client or
  Worker implementation code from it.
- Data access, domains, and provider adapters should be introduced only when real
  use cases require them. Avoid framework layers without two concrete consumers.

## Future boundaries

- Cloudflare Access is the perimeter authentication barrier. The Worker is the
  application authorization boundary: it verifies the signed Access assertion,
  then re-queries active D1 membership for every protected request.
- D1 stores structured family, pantry, recipe, plan, and nutrition references.
- R2 will store original/derived images with metadata and lifecycle policy in D1.
- AI calls originate from the Worker, pass through environment-specific AI
  Gateways, use `src/worker/ai` adapters, and return suggestions rather than
  authoritative nutrition facts. Local calls use a fake provider with no live
  binding or key.

## Reliability and observability

The health response is cache-disabled and contains no secrets. Cloudflare
observability is enabled in configuration; logging must remain minimal and must
not expose family data. Future state-changing endpoints need explicit error
contracts and idempotency decisions.

## PWA direction

A web app manifest and responsive shell establish the installable-web direction.
Offline mutation, background sync, and service-worker caching are deliberately
deferred until the product has real data consistency requirements; premature
caching would create stale-client and privacy risks.
