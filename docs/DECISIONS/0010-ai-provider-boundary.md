# ADR 0010: AI provider boundary through AI Gateway

- Status: Proposed
- Date: 2026-09-26
- Feature: [Recipe nutrition](../features/0084-recipe-nutrition.md)
- Issue: [#84](https://github.com/wpliao/meal-planner/issues/84)

## Context

[ARCHITECTURE.md](../ARCHITECTURE.md#future-boundaries) and
[SECURITY.md](../SECURITY.md) say that AI calls originate from the Worker,
pass through AI Gateway, use an adapter boundary, minimize the data they
disclose, and never supply authoritative nutrition. Feature #84 is the first
use: AI proposes which USDA food and how much each ingredient line means, and
a member confirms. Later Phase 7 features, such as AI meal suggestions, will
reuse the boundary.

The owner chose on 2026-09-26 to use Cloudflare Workers AI first and the
Gemini API's free tier as a fallback, both at no cost. Tests must be
deterministic and must not depend on paid or remote services.

## Decision

- **One interface.** In `src/worker/ai/`, a provider takes a system
  instruction, a JSON user message, and a JSON schema, and returns parsed JSON
  or a typed failure (`quota`, `timeout`, `invalid`, `unavailable`, or
  `error`). Feature code depends only on this interface and on a runner that
  tries providers in order.
- **Providers.**
  - Workers AI, through the `AI` binding with the environment's gateway ID,
    in JSON mode.
  - Gemini, through the same gateway's `google-ai-studio` endpoint, with the
    environment's key and structured output.
  - A deterministic fake, selected whenever `APP_ENV` is `local`. The local
    configuration has no `AI` binding and no Gemini key, so local development,
    Vitest, and Playwright can't reach a real provider.
- **Order and switches.** Workers AI first. Gemini is tried after a Workers AI
  failure, only while `GEMINI_FALLBACK` is `on` and the key is set. Model
  names are Worker variables. Setting a model to `off` disables that
  provider, so AI can be stopped without a redeploy of code.
- **Gateways and secrets.** Each environment has its own AI Gateway, with
  authentication on, and its own Gemini key in a project without billing
  ([ADR 0002](./0002-environment-isolation.md)). Keys and gateway tokens are
  Worker secrets. They are optional, and never `VITE_*` or logged.
- **Output is untrusted.** Callers validate every answer against their own
  schema and their own allowed values (for #84, the candidate food IDs the
  Worker supplied). An answer that fails is a provider failure, and the next
  provider is tried. AI output is never stored or shown as fact without a
  member's confirmation, and never supplies a nutrient value.
- **Data minimization.** Each feature's design lists exactly which fields it
  sends. Identity, household, and member data are never sent. The Worker logs
  the provider, outcome, latency, and counts, never prompts or answers.
- **Third-party terms.** The Gemini unpaid tier lets Google use content to
  improve its products and lets humans review it, and its terms bar users
  under 18. The owner accepted sending #84's title and ingredient lines, and
  stated that every household member is an adult. Adding a provider, moving
  to a paid tier, or sending more data needs a recorded owner decision.

## Consequences

- Providers can be added, reordered, or switched off by configuration,
  without changes to feature code.
- Every AI feature needs a fake-provider path for tests and a failure path
  that still lets the member finish by hand.
- Free tiers cap usage. When both are exhausted, AI features answer
  "unavailable" until the next day. Paid use would need a new decision.
- Workers AI JSON mode doesn't guarantee schema compliance, so validation
  failures are expected and handled by fallback.

## Status

Proposed with the #84 design. It becomes Accepted when the owner accepts that
design.
