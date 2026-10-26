-- Foreningen Samfolk (docs/decisions/0010-samfolk.md): members create ture themselves, the association holds one event
-- of its own a month, membership is by the month or the year, and anyone can sign up for the weekly Samfolk-brev.

-- The membership a member chose (paying opens later). Null for members from before Samfolk: they choose it when they
-- complete their profile.
ALTER TABLE members ADD COLUMN plan TEXT CHECK (plan IS NULL OR plan IN ('month', 'year'));

-- A tur is created by a member ('member'), or is Samfolk's own event, free for members ('samfolk'). The one who
-- creates it sets the deadline for sign-up and cancellation; without one, both stay open until it starts.
ALTER TABLE picks ADD COLUMN kind TEXT NOT NULL DEFAULT 'member' CHECK (kind IN ('member', 'samfolk'));
ALTER TABLE picks ADD COLUMN closes_at INTEGER;
CREATE INDEX picks_by_creator ON picks (created_by);

-- Samfolk-brevet, the weekly letter with the coming week's ture: members and anyone else who signs up.
CREATE TABLE newsletter (
  email TEXT PRIMARY KEY CHECK (length(email) BETWEEN 5 AND 160),
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
) STRICT;
