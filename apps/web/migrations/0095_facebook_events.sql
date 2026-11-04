-- Requested (the chair, 3 Nov 2026): the website promises that every event is put on Hjerterum's Facebook page as an event ("begivenhed"). Meta does not
-- let an app create those, so "Lisbeth opretter dem", and admin reminds her (cockpit/fbEvents.ts). One row per event that has been made on Facebook:
-- who said so, when, and the link if given. Additive.
CREATE TABLE facebook_events (
  event_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at_ms INTEGER NOT NULL,
  done_by TEXT NOT NULL,
  done_at_ms INTEGER NOT NULL,
  link TEXT
) STRICT;
