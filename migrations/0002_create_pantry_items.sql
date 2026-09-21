CREATE TABLE pantry_items (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN ('available', 'low', 'needed')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_source TEXT NOT NULL CHECK (created_source IN ('manual')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  UNIQUE (household_id, normalized_name)
) STRICT;

-- Household list reads order by signal rank and then name.
CREATE INDEX pantry_items_household_status_name_idx
  ON pantry_items (household_id, status, normalized_name);
