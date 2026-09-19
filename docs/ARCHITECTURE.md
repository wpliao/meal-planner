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

Phase 0 implements `GET /api/health` only. D1 and R2 are bound and exercised by
local Workers-runtime tests, but contain no product data model or upload logic.

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

- Cloudflare Access is the first authentication barrier. A later ADR must define
  identity mapping and application-level authorization before personal data APIs.
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
