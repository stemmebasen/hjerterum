-- Requested: "Generelt må hun gerne have al data fra den nuværende hjemmeside tilgængelig".
-- The text of every page and post on holistisk.org, read once a day through WordPress' API (no AI).
CREATE TABLE site_pages (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  modified TEXT,
  fetched_at_ms INTEGER NOT NULL
) STRICT;
