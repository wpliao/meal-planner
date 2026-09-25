-- Feature #78: household favourites and "Not now" for meal suggestions.
-- Additive only; no existing table is altered. At most one row per recipe,
-- and a row exists only while it holds a preference.
CREATE TABLE recipe_preferences (
  recipe_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  favourite INTEGER NOT NULL CHECK (favourite IN (0, 1)),
  -- When "Not now" ends, as an ISO instant such as 2026-10-02T12:00:00.000Z,
  -- or NULL. strftime() returns NULL for malformed text, and a CHECK whose
  -- result is NULL passes, so `IS` rather than `=` rejects it.
  not_now_until TEXT
    CHECK (not_now_until IS NULL
      OR not_now_until IS strftime('%Y-%m-%dT%H:%M:%fZ', not_now_until)),
  updated_at TEXT NOT NULL,
  -- A foreign key cannot require the recipe's household to match, so the
  -- Worker writes rows only through statements that check it.
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  CHECK (favourite = 1 OR not_now_until IS NOT NULL)
) STRICT;

-- The suggestions read and the pruning of expired rows read one household.
CREATE INDEX recipe_preferences_household_idx
  ON recipe_preferences (household_id);
