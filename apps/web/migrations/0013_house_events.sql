-- Requested: "You can also use this direct link so that Saga knows coming and historic events - could
-- be nice to showcase, and to be able to search through and even ask Saga about". Every event in
-- Hjerterum's public MembershipWorks calendar since 2019, kept here so the cockpit can show and
-- search them and Saga can answer from them. removed_at_ms: a coming event that left the calendar.
CREATE TABLE house_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at_ms INTEGER NOT NULL,
  ends_at_ms INTEGER,
  location TEXT,
  host TEXT,
  category TEXT,
  link TEXT,
  image_url TEXT,
  description TEXT,
  content_hash TEXT NOT NULL,
  removed_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_house_events_starts ON house_events(starts_at_ms);
