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

Phase 1 adds a trusted family boundary before product data is introduced. The
Worker validates Cloudflare Access application JWTs (or uses a deterministic
local identity adapter), maps the verified identity to a D1 household member,
and exposes session/bootstrap/member-management APIs. R2 remains reserved for
future binary objects; no recipe, pantry, meal-plan, or upload workflow is in
scope yet.

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
- D1 will store structured family, pantry, recipe, plan, and nutrition references.
- R2 will store original/derived images with metadata and lifecycle policy in D1.
- AI calls will originate from the Worker, pass through AI Gateway, use an adapter
  boundary, and return suggestions rather than authoritative nutrition facts.

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
