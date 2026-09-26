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

### Phase 0 — engineering foundation (complete)

Establish the client/Worker architecture, environments, tests, documentation,
security baseline, reproducible development setup, and gated delivery. The only
application behavior is a placeholder screen and health endpoint.

### Planned product phases

1. Trusted family boundary: validate identity, household membership, roles, and
   authorization before accepting personal product data.
2. Lightweight pantry: record useful availability and shopping signals without
   requiring exact consumption tracking.
3. Recipe library: create and edit household recipes and import an editable copy
   from an external website while retaining its original link and provenance.
4. Meal planning: place recipes and flexible meal entries onto a family plan.
5. Deterministic suggestions: rank explainable options from pantry, recipes,
   preferences, and recent plans before adding generative behavior.
6. Structured nutrition: calculate values from authoritative, cited data and
   explicit quantities rather than model-generated estimates.
7. Bounded AI assistance: add provider-neutral suggestion or transformation
   workflows through AI Gateway with human confirmation. Its provider
   boundary arrives early, with the first Phase 6 feature
   ([#84](features/0084-recipe-nutrition.md)), for ingredient matching only.
8. Photo ingestion: propose pantry updates from images and require review before
   changing structured records.
9. PWA and operations: add offline behavior only where consistency rules are
   defined, and mature backup, recovery, retention, and support workflows.

Each phase requires one or more accepted feature issues and designs. The sequence
may change through the documented feature lifecycle; this roadmap alone is not
permission to implement a feature.

## Out of scope for now

Public registration, native mobile applications, public sharing, automatic food
purchasing, medical dietary advice, and fully autonomous AI changes are excluded.
