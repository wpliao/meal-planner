-- Feature #84: recipe nutrition from USDA FoodData Central. Additive only:
-- one nullable column on recipes, and new tables. Bounds mirror
-- src/shared/nutrition.ts.

-- How many servings a recipe makes; NULL until a member sets it.
ALTER TABLE recipes ADD COLUMN servings INTEGER
  CHECK (servings IS NULL OR servings BETWEEN 1 AND 50);

-- Reference data (ADR 0009): a global, read-only copy of USDA FoodData
-- Central, loaded by scripts/nutrition-dataset-load.ts, not by members. It
-- holds no household data.

-- The loaded dataset. A load deletes this row first and writes it last, so
-- a load that stopped part-way is reloaded by the next deploy.
CREATE TABLE nutrition_dataset (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 100),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  food_count INTEGER NOT NULL CHECK (food_count >= 0),
  portion_count INTEGER NOT NULL CHECK (portion_count >= 0),
  loaded_at TEXT NOT NULL
) STRICT;

-- One USDA food. Nutrients are per 100 g, exactly as USDA reports them
-- (carbohydrate "by difference" can be slightly negative); NULL means USDA
-- reports no value, never zero. volume_seq names the portion that gives the
-- food's density.
CREATE TABLE nutrition_foods (
  fdc_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  data_type TEXT NOT NULL CHECK (data_type IN ('foundation', 'sr_legacy')),
  category TEXT NOT NULL CHECK (length(category) <= 100),
  release TEXT NOT NULL CHECK (length(release) BETWEEN 1 AND 20),
  energy_kj REAL,
  protein_g REAL,
  fat_g REAL,
  saturated_fat_g REAL,
  carbohydrate_g REAL,
  sugars_g REAL,
  fibre_g REAL,
  sodium_mg REAL,
  volume_seq INTEGER CHECK (volume_seq IS NULL OR volume_seq >= 1)
) STRICT;

-- USDA household measures: `amount` of `label` weighs `gram_weight`.
CREATE TABLE nutrition_food_portions (
  fdc_id INTEGER NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  amount REAL NOT NULL CHECK (amount > 0),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  gram_weight REAL NOT NULL CHECK (gram_weight > 0),
  PRIMARY KEY (fdc_id, seq),
  FOREIGN KEY (fdc_id) REFERENCES nutrition_foods(fdc_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

-- Full-text search over food names. External content: the loader rebuilds
-- it after writing nutrition_foods.
CREATE VIRTUAL TABLE nutrition_foods_fts USING fts5(
  name,
  content = 'nutrition_foods',
  content_rowid = 'fdc_id',
  tokenize = 'porter unicode61 remove_diacritics 2'
);

-- Household data: a member's confirmed match for one ingredient line. A row
-- names a food with an amount and its grams, or all four are NULL for
-- "Don't count". line_text is the line when it was confirmed; a match counts
-- only while the recipe still has that exact line at that position. There is
-- no foreign key to nutrition_foods, so reloading the reference data never
-- depends on household rows.
CREATE TABLE recipe_ingredient_matches (
  recipe_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 100),
  household_id TEXT NOT NULL,
  line_text TEXT NOT NULL CHECK (length(line_text) BETWEEN 1 AND 300),
  fdc_id INTEGER,
  quantity REAL,
  unit TEXT,
  grams REAL,
  -- strftime() returns NULL for malformed text, and a CHECK whose result is
  -- NULL passes, so `IS` rather than `=` rejects it.
  confirmed_at TEXT NOT NULL
    CHECK (confirmed_at IS strftime('%Y-%m-%dT%H:%M:%fZ', confirmed_at)),
  PRIMARY KEY (recipe_id, position),
  -- A foreign key cannot require the recipe's household to match, so the
  -- Worker writes rows only through statements that check it.
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  -- Each column is tested with IS NOT NULL first, so no comparison below can
  -- be NULL and slip through.
  CHECK (
    (fdc_id IS NULL AND quantity IS NULL AND unit IS NULL AND grams IS NULL)
    OR (fdc_id IS NOT NULL AND quantity IS NOT NULL AND unit IS NOT NULL
      AND grams IS NOT NULL
      AND fdc_id > 0
      AND quantity > 0 AND quantity <= 10000
      AND length(unit) BETWEEN 1 AND 20
      AND grams > 0 AND grams <= 10000)
  )
) STRICT;

-- Household decommission counts rows by household.
CREATE INDEX recipe_ingredient_matches_household_idx
  ON recipe_ingredient_matches (household_id);
