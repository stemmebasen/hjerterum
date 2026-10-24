-- Flokken: people who want to go to an event together. A member has a first name and a personal login code (stored
-- only as a hash); nothing else about them is kept. A flock (flok) is a small group going to one event, meeting at a
-- public place at a set time. Members join and leave themselves; after the event each member chooses whether they want
-- to find something to do together again (Eftermødet). Nobody is ever put in a flock without choosing it.

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 30),
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
) STRICT;

CREATE TABLE member_sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX member_sessions_member ON member_sessions (member_id);

CREATE TABLE flocks (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  created_by TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  meeting_place TEXT NOT NULL CHECK (length(meeting_place) BETWEEN 3 AND 120),
  meeting_at INTEGER NOT NULL,
  note TEXT CHECK (note IS NULL OR length(note) <= 280),
  max_size INTEGER NOT NULL DEFAULT 6 CHECK (max_size BETWEEN 2 AND 10),
  -- Set when the flock was started from an earlier flock's Eftermøde.
  follows_flock_id TEXT REFERENCES flocks(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX flocks_event ON flocks (event_id, status);
CREATE INDEX flocks_follows ON flocks (follows_flock_id);

CREATE TABLE flock_members (
  flock_id TEXT NOT NULL REFERENCES flocks(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  -- Eftermødet: 1 = wants to find something to do together again, 0 = not this time, NULL = not answered.
  again INTEGER CHECK (again IS NULL OR again IN (0, 1)),
  PRIMARY KEY (flock_id, member_id)
) STRICT;

CREATE INDEX flock_members_member ON flock_members (member_id);

-- Local associations and venues that want to work with Flokken, from the form on /samarbejde.
CREATE TABLE partner_inquiries (
  id TEXT PRIMARY KEY,
  organisation TEXT NOT NULL CHECK (length(organisation) BETWEEN 2 AND 120),
  contact_name TEXT NOT NULL CHECK (length(contact_name) BETWEEN 2 AND 80),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 5 AND 160),
  website TEXT CHECK (website IS NULL OR length(website) <= 200),
  message TEXT CHECK (message IS NULL OR length(message) <= 2000),
  created_at INTEGER NOT NULL
) STRICT;
