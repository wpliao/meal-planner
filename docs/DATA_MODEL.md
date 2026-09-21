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

## Phase 2 pantry model

[Feature #16](features/0016-lightweight-pantry.md) adds one household-owned
table for manual availability and shopping signals, created by
`migrations/0002_create_pantry_items.sql`. The migration is committed and
applied locally and in tests; remote environments apply it through the
protected deployment workflow.

```text
households (1) ──< pantry_items (*)
     │                    household_id → households.id
     └──< household_members (*)
```

Each pantry item has an opaque ID; household ID; human-readable and
normalized names; one of `available`, `low`, or `needed`; a version for
conflict-safe edits; manual-creation provenance; and creation/last-change
timestamps. The household owns the item: revoking the member who entered it
does not delete shared data. Names are unique only within a household. Every
query derives household scope from the verified Phase 1 member context, never
from client input. The shopping view is derived from `low` and `needed` rows,
not stored as a second list.

An item remains until an active member deletes it or the household is removed
through an explicitly authorized operational process. Item deletion removes
its current row; no application tombstone or edit history is retained. If the
household is eventually deleted, its pantry rows cascade after the
installation pointer is handled. Deletion from the live table does not imply
immediate erasure from D1's [Time Travel history](https://developers.cloudflare.com/d1/reference/time-travel/);
the available recovery window depends on the Workers plan and must be verified
before production release. No export, photo, external source, or automatic
consumption path exists in Phase 2; `created_source` is always `manual`.

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
