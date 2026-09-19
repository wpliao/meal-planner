# Product

## Vision

Provide one private, dependable place where a family can understand what food is
at home, decide what sounds good, receive grounded suggestions, keep recipes, and
plan meals from a phone, tablet, or desktop browser.

## Product principles

- Private by default: family access is explicit and data is not public.
- Useful before clever: structured pantry, recipe, and preference data come before
  generative AI features.
- Grounded results: nutrition is calculated from authoritative structured data;
  an LLM must never invent nutritional values.
- Human control: suggestions can be reviewed and changed, particularly recipe
  adjustments for sodium, taste, fat, or protein.
- Portable experience: responsive web first, with progressive PWA capabilities.
- Operable without a developer laptop: production runs entirely on managed cloud
  infrastructure and Git-based delivery.

## Phases

### Phase 0 — engineering foundation (current)

Establish the client/Worker architecture, environments, tests, documentation,
security baseline, reproducible development setup, and gated delivery. The only
application behavior is a placeholder screen and health endpoint.

### Candidate later phases

1. Family access and a minimal structured pantry.
2. Recipe storage and meal planning.
3. Preference-aware suggestions and recipe transformations.
4. Structured nutrition calculation and provenance.
5. Assisted fridge-photo ingestion with human confirmation.
6. Carefully bounded multi-provider AI support through AI Gateway.

Sequence and scope require product-owner decisions. This list is not permission
to implement features during Phase 0.

## Out of scope for now

Public registration, native mobile applications, public sharing, automatic food
purchasing, medical dietary advice, and fully autonomous AI changes are excluded.
