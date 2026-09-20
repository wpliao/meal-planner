PRAGMA foreign_keys = ON;

CREATE TABLE households (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE household_members (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  access_subject TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'revoked')),
  invited_at TEXT NOT NULL,
  activated_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  CHECK (
    (status = 'invited' AND access_subject IS NULL AND activated_at IS NULL AND revoked_at IS NULL)
    OR (status = 'active' AND access_subject IS NOT NULL AND activated_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND access_subject IS NOT NULL AND activated_at IS NOT NULL AND revoked_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX household_members_household_status_idx
  ON household_members (household_id, status);

CREATE TABLE app_installation (
  singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
  household_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE RESTRICT
) STRICT;
