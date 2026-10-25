-- Flokken as an association: events hand-picked with the associations behind them, an interest list, and the
-- volunteers who run it (admins, members with is_admin = 1, logging in with their personal code).

ALTER TABLE members ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));

-- An approved event: copied from a collected event (event_id) or typed in by hand, then edited freely. Only these are
-- shown on Flokken's pages.
CREATE TABLE picks (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  venue_name TEXT CHECK (venue_name IS NULL OR length(venue_name) <= 160),
  address TEXT CHECK (address IS NULL OR length(address) <= 200),
  city TEXT CHECK (city IS NULL OR length(city) <= 80),
  association TEXT NOT NULL CHECK (length(association) BETWEEN 2 AND 160),
  association_url TEXT CHECK (association_url IS NULL OR length(association_url) <= 300),
  event_url TEXT CHECK (event_url IS NULL OR length(event_url) <= 500),
  description TEXT CHECK (description IS NULL OR length(description) <= 4000),
  image_url TEXT CHECK (image_url IS NULL OR length(image_url) <= 500),
  places INTEGER CHECK (places IS NULL OR places BETWEEN 1 AND 200),
  own_payment TEXT CHECK (own_payment IS NULL OR length(own_payment) <= 120),
  aftermeeting TEXT CHECK (aftermeeting IS NULL OR length(aftermeeting) <= 200),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'withdrawn')),
  created_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX picks_by_start ON picks (status, starts_at);
CREATE UNIQUE INDEX picks_by_event ON picks (event_id) WHERE event_id IS NOT NULL;

-- The interest list: people who want to hear from Flokken, optionally for a given event.
CREATE TABLE interests (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 30),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 5 AND 160),
  age_group TEXT CHECK (age_group IS NULL OR age_group IN ('18-29', '30-39', '40-49', '50-59', '60-69', '70+')),
  interests TEXT CHECK (interests IS NULL OR length(interests) <= 300),
  area TEXT CHECK (area IS NULL OR length(area) <= 40),
  pick_id TEXT REFERENCES picks(id) ON DELETE SET NULL,
  with_friend INTEGER NOT NULL DEFAULT 0 CHECK (with_friend IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX interests_by_email ON interests (email);
CREATE INDEX interests_by_pick ON interests (pick_id);
