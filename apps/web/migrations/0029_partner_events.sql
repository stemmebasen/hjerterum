-- Partnerplanen, fase 1 (docs/PARTNERPLAN.md, docs/decisions/0006-partner-events.md): a partner gives
-- Hjerterum's members a discount on the partner's own events. Saga reads the partner's calendar feed and
-- shows the coming events in Hjerterum's calendar; signup and payment stay with the partner.

CREATE TABLE partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  website TEXT,
  contact_name TEXT,
  contact_email TEXT,
  -- An iCal (.ics) or RSS address. Without one no events are fetched.
  feed_url TEXT,
  discount_kind TEXT NOT NULL CHECK (discount_kind IN ('percent', 'amount')),
  -- Percent, or DKK minor units off the partner's own normal price.
  discount_value INTEGER NOT NULL CHECK (discount_value > 0 AND (discount_kind <> 'percent' OR discount_value <= 90)),
  -- How a member gets the discount (a code, showing the membership ...). Shown to members only.
  redemption TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  agreed_on TEXT,
  note TEXT,
  last_sync_at_ms INTEGER,
  last_sync_ok INTEGER CHECK (last_sync_ok IS NULL OR last_sync_ok IN (0, 1)),
  last_sync_message TEXT,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE partner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  source_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at_ms INTEGER NOT NULL,
  ends_at_ms INTEGER,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  location TEXT,
  description TEXT,
  link TEXT,
  image_url TEXT,
  category TEXT,
  -- The partner's normal price when the event text states it plainly; NULL when unknown.
  price_minor INTEGER CHECK (price_minor IS NULL OR price_minor >= 0),
  content_hash TEXT NOT NULL,
  -- The board can keep a single event out of the calendar; a new sync never undoes it.
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  hidden_by TEXT,
  -- Cancelled, or no longer in the partner's calendar.
  removed_at_ms INTEGER,
  first_seen_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (partner_id, source_uid)
) STRICT;

CREATE INDEX idx_partner_events_starts ON partner_events(starts_at_ms);

-- Fase 2's measurements, counted per Copenhagen day without any personal data. event_id 0 is the
-- partner as a whole (member_view: a member's calendar showed the partner's events).
CREATE TABLE partner_metrics (
  day TEXT NOT NULL,
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  event_id INTEGER NOT NULL DEFAULT 0,
  metric TEXT NOT NULL CHECK (metric IN ('click', 'member_click', 'member_view')),
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, partner_id, event_id, metric)
) STRICT;
