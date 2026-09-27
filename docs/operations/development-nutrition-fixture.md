# Development nutrition fixture for issue #98

Use the manual **Development nutrition fixture** GitHub Actions workflow on
`main` to create a repeatable, synthetic plan for [issue #98](../features/0098-meal-plan-nutrition-totals.md).
It has no production job or credentials. The job uses the protected
`development` GitHub environment and the configured development D1 database.
It does not call AI or edit the USDA dataset.

## Seed

Choose a future Monday for `week_start` with two empty weeks after it. For the
September 2026 validation, use **2026-11-02** if both it and 2026-11-09 are
empty. Dispatch on `main` with `mode=seed`, that date, and
`SEED_DEVELOPMENT_NUTRITION` as confirmation. The job checks that the D1
database matches `wrangler.jsonc`, an installed household has one active owner,
both weeks are empty, the recipe and plan limits have room, and the two pinned
USDA foods are loaded. It refuses an occupied week or existing fixture IDs.

The first week has six entries: a checked recipe planned twice, an unchecked
ingredient, a free-text meal, a recipe without servings, and a food with
missing USDA nutrient values. The next week fills all 126 plan slots with
42 distinct, fully checked synthetic recipes, each repeated three times. Each
stress recipe has eight ingredient lines, so the read covers 336 confirmed
lines. All titles begin `[DEV TEST]`. The workflow logs dates and counts only.
It does not read or print family recipe content or owner identity.

The seed is deliberately separate from deployment: it never publishes code,
applies migrations, or changes Worker settings. D1 writes are not assumed to
be atomic across the four seed stages. If a stage fails, run `cleanup` for the
same `week_start`, then retry `seed`. Do not use the app's **Clear week** action
as fixture cleanup; that leaves synthetic recipes in the library.

## Validate

On an authenticated phone, open `/plan/2026-11-02` (substitute the chosen
date). Confirm the one-serving note, daily/weekly values, **4 of 6** coverage,
the repeated recipe, and links for the incomplete recipes. The free-text meal
must contribute no number. The small week has spare plan slots for an edit and
refresh check.

Open the following Monday's plan and confirm **126 of 126** entries included,
with 18 per day and no gaps. To measure response time, inspect the
`GET /api/meal-plan/nutrition?week=...` request in browser Network tools over
five reloads and report only timings and status codes. In the Cloudflare
development Worker's metrics, inspect CPU time and resource errors over the
same period. The dashboard may aggregate other requests; label aggregate
figures as such. Do not share request/response bodies, recipe names, Access
assertions, or screenshots containing meal data.

## Clean up

Dispatch the same workflow on `main` with `mode=cleanup`, the original small
week Monday, and `CLEAN_DEVELOPMENT_NUTRITION`. Cleanup deletes only the
fixture's deterministic plan-entry IDs and recipe IDs; the recipe deletions
cascade to their ingredient lines and matches. It leaves USDA data and all
other household records alone. If a non-fixture entry now references one of
the fixture recipes, cleanup stops before deleting anything; remove that
entry in the app, then retry. Cleanup is safe to repeat and remains available
after the seeded week passes.

Record the workflow run, phone result, response timings, CPU/error evidence,
and cleanup run on issue #98 without private meal contents. Production release
still requires separate owner approval.
