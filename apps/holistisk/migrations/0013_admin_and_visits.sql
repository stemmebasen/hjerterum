-- Socialklubben's admin overview (/admin) and its own visitor statistics (src/stats.ts).
--
-- Admin login: a link sent only to the admin address (ADMIN_EMAIL, else the organisers' address). A link and the
-- session it starts are stored as hashes; a link works once, for an hour.
CREATE TABLE admin_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'session')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;
CREATE INDEX admin_tokens_created ON admin_tokens (kind, created_at);

-- Visits, counted on the server without cookies: page views per day and page, and visitors per day. A visitor is a
-- hash of the day's random salt, the IP address and the browser; the salt and the hashes are deleted the next night,
-- leaving only the day's count, so no one can be followed from one day to the next.
CREATE TABLE visit_days (
  day TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  visitors INTEGER
) STRICT;

CREATE TABLE visit_pages (
  day TEXT NOT NULL,
  path TEXT NOT NULL CHECK (length(path) <= 120),
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
) STRICT;

CREATE TABLE visit_sources (
  day TEXT NOT NULL,
  source TEXT NOT NULL CHECK (length(source) <= 80),
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source)
) STRICT;

CREATE TABLE visit_visitors (
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (day, visitor)
) STRICT;

CREATE TABLE visit_salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
) STRICT;
