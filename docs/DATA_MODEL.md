# Data model

Phase 1 introduces only the identity and household-boundary tables needed to
authorize product data. Later phases add product tables only through accepted
feature designs; the schema still deliberately excludes speculative nutrition
and image concepts.

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

## Phase 3 recipe model

[Feature #31](features/0031-recipe-library.md) adds a household-owned recipe
library, created by `migrations/0003_create_recipes.sql`. The migration is
additive: it creates three tables and one index and alters nothing that
exists. It is committed and applied locally and in tests; it has not been
applied to any remote environment.

```text
households (1) ──< recipes (*) ──< recipe_ingredients (*)
                        │               recipe_id → recipes.id
                        └────────< recipe_steps (*)
                                        recipe_id → recipes.id
```

Each recipe has an opaque ID; household ID; a title (not unique, since two
sources can share one); optional notes; a version for conflict-safe edits; a
per-write token (see below); `manual` or `website` source kind; and
creation/last-change timestamps. A website copy also stores the submitted URL
(without its fragment), the final resolved URL when it differs, the source
host derived from the URL the text came from, the source page title when
available, and the server-assigned import time. A `CHECK` requires those link
columns for `website` rows and forbids them for `manual` rows. No remote HTML,
request header, cookie, or debug body is stored.

`recipe_ingredients` and `recipe_steps` hold one plain-text line per row with
a 1-based `position`; `(recipe_id, position)` is the primary key. Ingredients
are unstructured text such as `2 tbsp soy sauce`; there are no quantity or
unit columns, so no ingredient line is a nutrition source.

`CHECK` constraints enforce the storage bounds from `src/shared/recipes.ts`,
counted in Unicode code points as SQLite `length()` does: title 1–120, notes
1–4,000 or `NULL`, each ingredient 1–300 at positions 1–100, each step
1–2,000 at positions 1–50, each source URL up to 2,048, host up to 253, and
page title up to 200. The minimum of one ingredient and one step and the
500-recipe household limit are enforced by the Worker; the limit uses a
guarded `INSERT … SELECT` so it stays race-safe.

Writes run as one D1 batch (a transaction). Every recipe write sets a fresh
random `write_token`, and each child-row statement in the same batch requires
that token. A D1 batch keeps running after a guarded `UPDATE … WHERE version =
?` matches no row, so a version-only guard on the child rows would let a
losing concurrent update rewrite the winner's lines; the token makes the loser
change nothing. The token never leaves the Worker.

`recipes.household_id` cascades from `households`, and both line tables
cascade from `recipes`, as the [#32 design](features/0032-household-lifecycle.md)
and [ADR 0008](DECISIONS/0008-household-decommissioning.md) require. Deleting
a recipe removes its lines. The operator's household deletion (clear
`app_installation`, then delete the household, in one batch) removes every
recipe row with no further change. As with the pantry, deletion from the live
tables does not imply erasure from D1 Time Travel history.

## Phase 4 meal-plan model

[Feature #49](features/0049-meal-planning.md) adds a shared household meal
plan, created by `migrations/0004_create_meal_plan_entries.sql`. The migration
is additive: it creates one table and two indexes and alters nothing that
exists. It is committed and applied locally and in tests; it has not been
applied to any remote environment.

```text
households (1) ──< meal_plan_entries (*) >── (0..1) recipes
                     household_id → households.id   ON DELETE CASCADE
                     recipe_id    → recipes.id      ON DELETE SET NULL
```

Each entry has an opaque ID; household ID; a calendar `plan_date`
(`YYYY-MM-DD`, with no time and no time zone); a `meal_slot` of `breakfast`,
`lunch`, or `dinner`; a `kind` of `recipe` or `text`; a nullable `recipe_id`;
a `title`; an optional one-line `note`; `placed_at`, which orders entries
within a meal and is reset by every move; a version for conflict-safe edits;
and creation/last-change timestamps. The household owns the plan, as it owns
the pantry and recipes, and every active member may change it.

A text entry's `title` is its text. A recipe entry's `title` is the recipe's
title when it was placed, refreshed to the recipe's last title when the recipe
is deleted; reads show the live recipe title through a join on both the recipe
ID and the entry's household, so a renamed recipe needs no write and a recipe
from another household can never supply a title or ID. Deleting a recipe runs
one batch: a version-guarded `UPDATE` copies the last title onto its entries,
then the version-guarded `DELETE` lets `ON DELETE SET NULL` drop the link. A
stale recipe delete changes neither. A recipe entry whose `recipe_id` is null
is reported as `recipeRemoved`.

`CHECK` constraints enforce the storage bounds from `src/shared/meal-plan.ts`:
a real calendar date (`date(plan_date) IS plan_date`; `IS` rather than `=`
because `date()` returns `NULL` for malformed text and a `CHECK` that is
`NULL` passes), the three meals, the two kinds, no `recipe_id` on a text
entry, title 1–120 and note 1–200 code points or `NULL`, and a positive
version. A foreign key cannot require a recipe's household to match the
entry's, so the Worker writes `recipe_id` only through an `INSERT … SELECT`
that requires `recipes.household_id` to equal the caller's household. The
limits of 6 entries per meal per day and 4,000 per household, and the write
window of 8 weeks back to 52 weeks ahead, are enforced by the Worker; both
limits use guarded statements, so concurrent writes cannot exceed them. The
`(household_id, plan_date)` index serves the week read and the limits; the
`recipe_id` index serves `ON DELETE SET NULL`.

Entries are kept until a member removes them or the household is deleted.
There is no time-based deletion: the 4,000-entry limit bounds stored history.
Removing an entry deletes its row, with no tombstone or edit history.
[Feature #56](features/0056-clear-past-week.md) lets a member clear a week
that has ended in one `DELETE` statement, which removes the week's entries
only if the week still holds exactly the entries and versions the member
confirmed; otherwise it removes nothing. It adds no table or column. The week
read also reports the household's entry count and oldest planned date, from
the same `(household_id, plan_date)` index.
`meal_plan_entries.household_id` cascades from `households`, so the #32
operator batch removes every entry with no further change, and the
decommission procedure counts the table. As with the pantry and recipes,
deletion from the live table does not imply erasure from D1 Time Travel
history.

## Phase 5 recipe preference model

[Feature #78](features/0078-recipe-preferences.md) stores the household's
preferences about its recipes, created by
`migrations/0005_create_recipe_preferences.sql`. The migration is additive:
it creates one table and one index and alters nothing that exists.

```text
households (1) ──< recipe_preferences (0..1) >── (1) recipes
                     household_id → households.id   ON DELETE CASCADE
                     recipe_id    → recipes.id      ON DELETE CASCADE (primary key)
```

A row holds `favourite` (0 or 1), `not_now_until` (the ISO instant when "Not
now" ends, or `NULL`), and `updated_at`. It exists only while it holds a
preference: a `CHECK` requires `favourite = 1` or an end instant, and a second
`CHECK` requires the instant to be in the exact form
`strftime('%Y-%m-%dT%H:%M:%fZ')` produces, compared with `IS` so that a
malformed value, for which `strftime()` returns `NULL`, is refused. The
preferences belong to the household, like the pantry and the plan; the table
records no member identity. They are household state about a recipe, not
recipe content, so a change never touches the recipe row or its version.

A foreign key cannot require the recipe's household to match the row's, so
the Worker writes rows only through an `INSERT … SELECT` from `recipes` by both
ID and household. Clearing the last preference deletes the row. "Not now"
lasts exactly 7 × 24 hours from the Worker's clock. An ended "Not now" is
ignored on every read, and every preference write removes the household's
ended entries in the same batch. Deleting a recipe or the household deletes
its rows; the #32 decommission procedure counts the table. As elsewhere,
deletion from the live table does not imply erasure from D1 Time Travel
history.

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
