-- Requested: the overview's programme - Saga's short warm intro to the next two events, written once a day and kept.
CREATE TABLE event_blurbs (
  key TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;
