-- holistisk.org event portal: its own database, separate from Hjerterum's.
-- Instants are Unix epoch milliseconds in UTC; display happens in each event's time zone (Europe/Copenhagen).
-- Money is stored in minor units (øre).

-- Every source the collector reads, mirrored from src/sources/registry.ts on each run, with the basis for using it.
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL,
  homepage_url TEXT,
  permission_basis TEXT NOT NULL,
  attribution TEXT NOT NULL,
  image_policy TEXT NOT NULL CHECK (image_policy IN ('allowed', 'none')),
  description_policy TEXT NOT NULL CHECK (description_policy IN ('full', 'excerpt', 'none')),
  priority INTEGER NOT NULL DEFAULT 50,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
) STRICT;

-- Organisers: today a name and a website; later the place for organiser profiles and partnerships.
CREATE TABLE organizers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  summary TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  timezone TEXT NOT NULL DEFAULT 'Europe/Copenhagen',
  organizer_id TEXT REFERENCES organizers(id),
  host_name TEXT,
  venue_name TEXT,
  address TEXT,
  postal_code TEXT,
  city TEXT,
  area TEXT,
  region TEXT,
  lat REAL,
  lon REAL,
  price_min_minor INTEGER CHECK (price_min_minor IS NULL OR price_min_minor >= 0),
  price_max_minor INTEGER CHECK (price_max_minor IS NULL OR price_max_minor >= 0),
  price_currency TEXT,
  price_text TEXT,
  is_free INTEGER CHECK (is_free IS NULL OR is_free IN (0, 1)),
  signup_url TEXT,
  image_url TEXT,
  image_credit TEXT,
  primary_source_id TEXT NOT NULL REFERENCES sources(id),
  source_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'cancelled', 'past', 'withdrawn')),
  fingerprint TEXT NOT NULL,
  search_text TEXT NOT NULL,
  quality_flags TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  missing_runs INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_checked_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
) STRICT;

CREATE INDEX events_status_start ON events (status, starts_at);
CREATE INDEX events_area_start ON events (area, starts_at);
CREATE INDEX events_fingerprint ON events (fingerprint);
CREATE INDEX events_start ON events (starts_at);

CREATE TABLE event_categories (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, category)
) STRICT;

CREATE INDEX event_categories_category ON event_categories (category, event_id);

-- One row per record in a source. Several sources may point at the same event (a cross-source duplicate).
CREATE TABLE event_sources (
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_url TEXT,
  content_hash TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, source_event_id)
) STRICT;

CREATE INDEX event_sources_event ON event_sources (event_id);

-- What changed and when: new, updated, rescheduled, cancelled, withdrawn, reappeared, merged duplicates.
CREATE TABLE event_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  run_id TEXT,
  changed_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX event_changes_event ON event_changes (event_id, changed_at);

-- The collector's log: one row per run, one row per source in it.
CREATE TABLE ingest_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  summary TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX ingest_runs_started ON ingest_runs (started_at);

CREATE TABLE ingest_source_runs (
  run_id TEXT NOT NULL REFERENCES ingest_runs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  withdrawn INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY (run_id, source_id)
) STRICT;
