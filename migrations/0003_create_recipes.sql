-- Feature #31: household recipe library. Additive only; no existing table is
-- altered. Bounds mirror src/shared/recipes.ts, where lengths are Unicode code
-- points, which is what SQLite length() counts for TEXT.
CREATE TABLE recipes (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  notes TEXT CHECK (notes IS NULL OR length(notes) BETWEEN 1 AND 4000),
  version INTEGER NOT NULL CHECK (version > 0),
  -- A fresh random value set by every write. Child-row statements in the same
  -- batch run only while the row still carries their own write's token, so a
  -- losing concurrent update can never rewrite the winner's lines.
  write_token TEXT NOT NULL CHECK (length(write_token) BETWEEN 1 AND 64),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'website')),
  source_submitted_url TEXT
    CHECK (source_submitted_url IS NULL OR length(source_submitted_url) BETWEEN 1 AND 2048),
  source_resolved_url TEXT
    CHECK (source_resolved_url IS NULL OR length(source_resolved_url) BETWEEN 1 AND 2048),
  source_host TEXT
    CHECK (source_host IS NULL OR length(source_host) BETWEEN 1 AND 253),
  source_page_title TEXT
    CHECK (source_page_title IS NULL OR length(source_page_title) BETWEEN 1 AND 200),
  source_imported_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  CHECK (
    (source_kind = 'manual'
      AND source_submitted_url IS NULL
      AND source_resolved_url IS NULL
      AND source_host IS NULL
      AND source_page_title IS NULL
      AND source_imported_at IS NULL)
    OR (source_kind = 'website'
      AND source_submitted_url IS NOT NULL
      AND source_host IS NOT NULL
      AND source_imported_at IS NOT NULL)
  )
) STRICT;

-- The library list reads one household, most recently changed first; the
-- household limit counts the same prefix.
CREATE INDEX recipes_household_updated_idx
  ON recipes (household_id, updated_at);

-- Positions are 1-based. The range and the uniqueness of (recipe, position)
-- together bound the number of lines per recipe.
CREATE TABLE recipe_ingredients (
  recipe_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 100),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
  PRIMARY KEY (recipe_id, position),
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE recipe_steps (
  recipe_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 50),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  PRIMARY KEY (recipe_id, position),
  FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
) STRICT;
