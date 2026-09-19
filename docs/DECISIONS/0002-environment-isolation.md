# ADR 0002: Explicit environment isolation

- Status: Accepted
- Date: 2026-09-19

## Context

Production must not depend on a development computer and family data must not be
mixed with test activity. Cloudflare Wrangler bindings are not inherited by named
environments, which can cause silent omissions if configuration is assumed to
flow from the default environment.

## Decision

Represent local, development, and production in `wrangler.jsonc`; repeat every
environment-specific variable and binding; use distinct Worker names, D1
databases, and R2 buckets; and scope deployment credentials through matching
GitHub environments. Production deploys are manual, require a confirmation value,
and target a protected GitHub environment with owner-configured reviewers.

## Consequences

Configuration is more repetitive but resource boundaries are reviewable in Git.
Cloudflare resource IDs must be configured once by an account owner. Local tests
remain independent of cloud accounts. Production cannot be deployed until both
repository configuration and external approval controls are complete.
