-- "Dagens fem" (Jake 2026-11-17): the calendar shows at most five arrangements a day, picked for how well they suit
-- going out with others (src/curation.ts). The pick is made again after every collector run and whenever the admin
-- pins or hides an arrangement.

-- The current pick: one row per picked arrangement, with its day (local date), place in the day and score.
CREATE TABLE event_picks (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  picked_at INTEGER NOT NULL
) STRICT;
CREATE INDEX event_picks_day ON event_picks (day, rank);

-- The admin's own choices: 'pin' always puts an arrangement among its day's picks, 'hide' takes it off the site's
-- lists and search (its own page still opens).
CREATE TABLE event_curation (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('pin', 'hide')),
  updated_at INTEGER NOT NULL
) STRICT;
