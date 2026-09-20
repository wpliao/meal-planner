# Data model

Phase 1 introduces only the identity and household-boundary tables needed to
authorize future product data. Schema still deliberately excludes speculative
pantry, recipe, nutrition, and meal-plan concepts.

## Phase 1 tables

- `households` stores the opaque household ID, display name, and lifecycle
  timestamps.
- `household_members` stores the normalized verified email, optional Cloudflare
  Access subject, role (`owner` or `member`), status (`invited`, `active`, or
  `revoked`), and lifecycle timestamps. Email and Access subject are globally
  unique for the one-household-per-identity Phase 1 rule.
- `app_installation` is a singleton pointer to the bootstrapped household. Its
  primary key makes first-owner creation explicit and race-safe.

All member reads and writes are scoped by the actor's household ID, even though
member IDs are opaque and globally unique. Prepared statements, foreign keys,
and role/status checks enforce the same boundary in the database and service
layers.

## Durable principles

- D1 is authoritative for structured application data.
- R2 object keys and lifecycle metadata are referenced from D1; R2 is not a
  queryable source of business truth.
- Store ingredient quantities, units, nutrition sources, and provenance as
  structured values. Generated text cannot be a nutrition source.
- Include ownership/family scope in every personal-data access path.
- Prefer stable identifiers, explicit timestamps, and auditable source metadata.
- Decide deletion and retention behavior before accepting photos or sensitive
  preferences.

## Migration policy

Migration files live in `migrations/`, use ordered numeric names, and are
immutable after application. Every schema change is tested locally, applied to
development, and explicitly approved for production. Direct manual production
schema changes are prohibited. Destructive transformations require a documented
backup, forward recovery, and rollout plan.

The first product-data issue must add an ADR or update this document with an
entity diagram, ownership rules, deletion behavior, and source provenance.
