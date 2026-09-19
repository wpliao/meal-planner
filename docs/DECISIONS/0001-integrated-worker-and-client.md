# ADR 0001: Integrated Worker and React client

- Status: Accepted
- Date: 2026-09-19

## Context

The private application needs a responsive React client and a small Cloudflare
API. Separate frontend hosting and API services would add CORS, deployment, local
development, and operational complexity before the product needs independent
scaling boundaries.

## Decision

Use Vite with the official Cloudflare Vite plugin to build a React client and
module Worker as one Cloudflare Worker with Static Assets. Reserve `/api/*` for
Worker endpoints and serve the client on the same origin. Use the current official
Cloudflare Vitest integration to exercise API code inside the Workers runtime.

## Consequences

Local development and deployment share a close topology, API calls require no
CORS policy, and one artifact is easy to operate. A Worker or client can be split
later if independent scaling, ownership, or security needs justify the additional
boundary. The application must keep client, shared contract, and Worker code
separated so such a split remains possible.
