# Data model

Phase 0 defines no product tables. This is deliberate: schema should follow
validated workflows rather than encode speculative pantry or recipe concepts.

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
