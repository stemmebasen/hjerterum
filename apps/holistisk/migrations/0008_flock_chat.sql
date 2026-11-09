-- A small chat in each flock (flok): only the flock's current members can read and write in it. Phone numbers and
-- e-mail addresses are masked before a message is saved. Writing closes a week after the event; messages are deleted
-- 30 days after the event. A member can report a message; it is hidden from them at once, and from everyone once two
-- members have reported it (hidden_at).

CREATE TABLE flock_messages (
  id TEXT PRIMARY KEY,
  flock_id TEXT NOT NULL REFERENCES flocks(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  hidden_at INTEGER
) STRICT;

CREATE INDEX flock_messages_flock ON flock_messages (flock_id, created_at);
CREATE INDEX flock_messages_member ON flock_messages (member_id, created_at);

CREATE TABLE flock_message_reports (
  message_id TEXT NOT NULL REFERENCES flock_messages(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, member_id)
) STRICT;

CREATE INDEX flock_message_reports_created ON flock_message_reports (created_at);
