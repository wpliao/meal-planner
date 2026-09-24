# D1 migrations

Migration `0001_create_household_identity.sql` establishes the Phase 1
household/member authorization boundary. It creates `households`,
`household_members`, and the singleton `app_installation` table; it does not
create pantry, recipe, nutrition, image, or meal-plan data.

Migration `0002_create_pantry_items.sql` adds the household pantry for
[feature #16](../docs/features/0016-lightweight-pantry.md).

Migration `0003_create_recipes.sql` adds the household recipe library for
[feature #31](../docs/features/0031-recipe-library.md): `recipes`,
`recipe_ingredients`, and `recipe_steps`, with cascading foreign keys from the
household and the recipe, and `CHECK` constraints for the shared bounds. It is
additive and alters no existing table. Rolling back the Worker leaves the
unused tables in place; reversing the migration would delete family recipes
and needs a separately approved forward migration, not an edit to `0003`.
See `docs/DATA_MODEL.md`.

Migration `0004_create_meal_plan_entries.sql` adds the shared household meal
plan for [feature #49](../docs/features/0049-meal-planning.md):
`meal_plan_entries`, cascading from the household, with `recipe_id` set to
`NULL` when its recipe is deleted. It is additive and alters no existing
table. The household decommission procedure counts the table; a later table
must be added there in the same pull request as its migration.

Migrations are immutable and ordered. Test each migration against a fresh local
D1 database, apply it to the development D1 database before any production
rollout, and obtain explicit production approval before applying it to
production. Never edit an applied migration; add a forward migration instead.
See `AGENTS.md` and `docs/DATA_MODEL.md`.

`pnpm dev` applies pending migrations to the ignored local D1 state before
starting the application. The E2E harness applies them to a separate temporary
D1 state for each browser project.

For a named environment, use Wrangler's D1 migration command with the matching
environment and database binding, review the planned target carefully, and
record the result in the feature document. Do not point a development command at
the production database.
