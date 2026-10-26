-- Flokk: members and sign-ups for Udflugter (docs/decisions/0009-flokk-udflugter.md).

-- A Flokk member has an e-mail and a join date; members of the event portal (Socialklubben) have neither.
ALTER TABLE members ADD COLUMN email TEXT CHECK (email IS NULL OR length(email) BETWEEN 5 AND 160);
ALTER TABLE members ADD COLUMN flokk_joined_at INTEGER;
ALTER TABLE members ADD COLUMN interests TEXT CHECK (interests IS NULL OR length(interests) <= 300);
ALTER TABLE members ADD COLUMN area TEXT CHECK (area IS NULL OR length(area) <= 40);
ALTER TABLE members ADD COLUMN age_group TEXT CHECK (age_group IS NULL OR age_group IN ('18-29', '30-39', '40-49', '50-59', '60-69', '70+'));
CREATE UNIQUE INDEX members_email ON members (email) WHERE email IS NOT NULL;

-- An Udflugt's practical information, when its flock was confirmed (four signed up), and when Flokk cancelled its
-- participation (the organiser's event is another matter).
ALTER TABLE picks ADD COLUMN meeting_place TEXT CHECK (meeting_place IS NULL OR length(meeting_place) <= 200);
ALTER TABLE picks ADD COLUMN meeting_at INTEGER;
ALTER TABLE picks ADD COLUMN programme TEXT CHECK (programme IS NULL OR length(programme) <= 2000);
ALTER TABLE picks ADD COLUMN confirmed_at INTEGER;
ALTER TABLE picks ADD COLUMN flokk_cancelled_at INTEGER;

-- One line per member and Udflugt. The queue is first come, first served by queued_at; signing up again after
-- cancelling puts the member at the back.
CREATE TABLE signups (
  id TEXT PRIMARY KEY,
  pick_id TEXT NOT NULL REFERENCES picks(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('registered', 'waitlist', 'cancelled')),
  queued_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX signups_one ON signups (pick_id, member_id);
CREATE INDEX signups_queue ON signups (pick_id, status, queued_at);
CREATE INDEX signups_member ON signups (member_id);
