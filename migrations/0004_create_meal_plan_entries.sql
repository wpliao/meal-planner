-- Feature #49: shared household meal plan. Additive only; no existing table is
-- altered. Bounds mirror src/shared/meal-plan.ts, where lengths are Unicode
-- code points, which is what SQLite length() counts for TEXT.
CREATE TABLE meal_plan_entries (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  -- A calendar date with no time or time zone. date() rolls an impossible
  -- date such as 2026-02-30 forward and returns NULL for malformed text such
  -- as 2026-2-3. A CHECK whose result is NULL passes, so `=` would accept the
  -- malformed text; `IS` treats NULL as a mismatch and rejects both.
  plan_date TEXT NOT NULL CHECK (date(plan_date) IS plan_date),
  meal_slot TEXT NOT NULL CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner')),
  kind TEXT NOT NULL CHECK (kind IN ('recipe', 'text')),
  -- Set to NULL when the recipe is deleted; the entry keeps its last title.
  -- A foreign key cannot require the recipe's household to match, so the
  -- Worker writes this column only through statements that check it.
  recipe_id TEXT,
  -- The free text, or the recipe's title when placed or when it was deleted.
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200),
  -- Orders entries within a slot; set on create and on every move.
  placed_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL,
  CHECK (kind = 'recipe' OR recipe_id IS NULL)
) STRICT;

-- The week read and both limits read one household's dates.
CREATE INDEX meal_plan_entries_household_date_idx
  ON meal_plan_entries (household_id, plan_date);

-- ON DELETE SET NULL looks up entries by recipe; without this index every
-- recipe delete would scan the whole table.
CREATE INDEX meal_plan_entries_recipe_idx
  ON meal_plan_entries (recipe_id);
