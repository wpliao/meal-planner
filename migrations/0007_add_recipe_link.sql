-- Feature #113: an optional link on a manually entered recipe. Additive only:
-- one nullable column, so every existing recipe keeps no link and older Worker
-- code can ignore it. Bounds mirror src/shared/recipes.ts; the link is stored
-- and shown, never fetched.
ALTER TABLE recipes ADD COLUMN link_url TEXT
  CHECK (link_url IS NULL OR (
    source_kind = 'manual'
    AND length(link_url) BETWEEN 9 AND 2048
    AND substr(link_url, 1, 8) = 'https://'));
