-- Requested: "Byg en statistikside i jeres admin over besøg på jeres offentlige hjemmeside, og et read-only API" - the
-- public website's page views, counted without cookies (worker/site-stats.ts). A visitor is an HMAC of the address,
-- browser and host with a secret that changes every day, so no one can be followed from one day to the next, and no
-- address is ever stored. Source and campaign are kept only for a visitor's first page of the day (entry = 1).
-- Rows are deleted after six months.
CREATE TABLE site_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  visitor TEXT NOT NULL,
  path TEXT NOT NULL,
  entry INTEGER NOT NULL DEFAULT 0 CHECK (entry IN (0, 1)),
  referrer TEXT,
  campaign TEXT,
  device TEXT NOT NULL CHECK (device IN ('mobile', 'tablet', 'desktop')),
  country TEXT
) STRICT;

CREATE INDEX idx_site_visits_day ON site_visits(day);
CREATE INDEX idx_site_visits_visitor ON site_visits(day, visitor);
