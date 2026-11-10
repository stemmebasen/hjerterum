-- Socialklubben's interest list ("Lad os komme godt i gang"): a member ticks the events they would like to go to with
-- others. When three are waiting for the same event, a flock is gathered (at most six) and they are invited; each has
-- 48 hours to confirm, after which the place goes to the next one waiting. A member's e-mail (members.email) is used
-- to tell them; until mail is sent, the invitation shows under Mine flokke. `notified_at` is when it was mailed.
CREATE TABLE event_interests (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'invited', 'confirmed', 'declined', 'expired')),
  flock_id TEXT REFERENCES flocks(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  invited_at INTEGER,
  respond_by INTEGER,
  notified_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, event_id)
) STRICT;
CREATE INDEX event_interests_event ON event_interests (event_id, status, created_at);
CREATE INDEX event_interests_due ON event_interests (status, respond_by);
