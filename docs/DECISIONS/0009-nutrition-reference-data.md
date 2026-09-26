# ADR 0009: Nutrition reference data from USDA FoodData Central

- Status: Accepted
- Date: 2026-09-26
- Feature: [Recipe nutrition](../features/0084-recipe-nutrition.md)
- Issue: [#84](https://github.com/wpliao/meal-planner/issues/84)
- Accepted by product owner: [PR comment](https://github.com/wpliao/meal-planner/pull/85#issuecomment-5843856770)

## Context

[PRODUCT.md](../PRODUCT.md#product-principles) requires nutrition to be
calculated from authoritative, cited structured data and explicit
quantities, never from model output. Recipes hold free-text ingredient lines,
so the application needs a food composition database it can store, search,
and cite. Every later nutrition feature, such as plan totals, depends on this
choice.

Options the owner considered on 2026-09-26:

- **USDA FoodData Central** (Foundation Foods, April 2026; SR Legacy, April
  2018). Public domain under CC0 1.0; USDA asks users to name FoodData
  Central as the source. About 8,200 generic foods, with values per 100 g and
  gram weights for household measures.
- **Australian Food Composition Database** (FSANZ). About 1,600 foods under
  CC BY-SA 3.0 AU, with a required notice that Australian data may not suit
  other countries.
- **New Zealand FOODfiles.** The best fit for NZ foods, but its
  [terms](https://www.foodcomposition.co.nz/terms/) forbid modifying the data
  and require it to be shown unaltered, so storing a subset would need
  written permission.
- **The USDA API at runtime**, which needs a key, has rate limits, and makes
  every lookup depend on an external service.

## Decision

Use a pinned, filtered copy of USDA FoodData Central Foundation Foods and SR
Legacy, loaded into each environment's D1 as global, read-only reference
tables (`nutrition_dataset`, `nutrition_foods`, `nutrition_food_portions`,
and an FTS5 index over names). The copy holds each food's FDC ID, name, data
type, category, and release; eight nutrients per 100 g; and portion gram
weights.

The eight nutrients are the NZ/AU label panel, taken from these USDA nutrient
numbers:

| Panel row     | USDA nutrient (number)                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Energy        | Energy, kJ (268); else Energy, kcal (208) × 4.184; else Atwater specific (958) then general (957) factors, kcal × 4.184 |
| Protein       | Protein (203)                                                                                                           |
| Fat, total    | Total lipid (fat) (204)                                                                                                 |
| Saturated fat | Fatty acids, total saturated (606)                                                                                      |
| Carbohydrate  | Carbohydrate, by difference (205)                                                                                       |
| Sugars        | Sugars, total including NLEA (269); else Sugars, total (269.3)                                                          |
| Dietary fibre | Fiber, total dietary (291)                                                                                              |
| Sodium        | Sodium, Na (307)                                                                                                        |

A missing nutrient is stored as `NULL`, never as zero. The build script
verifies these numbers against the pinned releases' `nutrient.csv` and fails
on any mismatch.

- Values reach a member only through the Worker's calculation from these
  tables and confirmed grams. Nothing else, including AI output, can supply a
  nutrient value.
- Each displayed food links to its FoodData Central page and cites "U.S.
  Department of Agriculture, Agricultural Research Service. FoodData
  Central."
- The dataset has a version. Changing it (a new Foundation release, another
  database, or more nutrients) is a new, reviewed dataset version, recorded in
  the owning feature's decision log. A food that disappears never breaks a
  saved match; the match shows as needing a check.
- Development and production load the same dataset version, each into its
  own database ([ADR 0002](./0002-environment-isolation.md)).

The #84 design (decision 1) builds the copy with a script that checks the
pinned releases' SHA-256, commits the filtered dataset file to the
repository, and loads it with a versioned Deploy step after migrations.

## Consequences

- No runtime dependency on USDA, no key, and no cost.
- Food names are American ("cilantro", "ground beef"). The AI normalization
  step in [ADR 0010](./0010-ai-provider-boundary.md) bridges NZ wording.
  Branded and NZ-specific products aren't covered.
- SR Legacy is frozen at April 2018. Foundation Foods updates about twice a
  year, and taking an update is a deliberate change.
- D1 holds a few megabytes of reference data per environment. `wrangler d1
export` can't export FTS5 virtual tables. The project's recovery uses D1
  Time Travel, and the index can be rebuilt from the dataset file.
- The household decommission inventory lists the reference tables as known
  tables that hold no household data.

## Status

Accepted on 2026-09-26 with the #84 design.
