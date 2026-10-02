-- Requested: "Jo men holistisk.org indhold bliver ikke ved med at være tilgængelig så det skal lagres".
-- Nothing on the site is ever deleted: a page gone from the site is marked removed, a changed page keeps its earlier
-- text, and the media files are copied to R2.
ALTER TABLE site_pages ADD COLUMN removed_at_ms INTEGER;

CREATE TABLE site_page_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  text TEXT NOT NULL,
  modified TEXT,
  fetched_at_ms INTEGER NOT NULL,
  replaced_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_site_page_versions_url ON site_page_versions(url, replaced_at_ms);

CREATE TABLE site_media (
  url TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER,
  stored_at_ms INTEGER,
  tries INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
) STRICT;
