-- Requested: "Husk også, at Saga skal godkende events som medlemmer selv sætter op ud fra kriterier der
-- allerede ligger i blueprint eller systemet." BLUEPRINT: only paying members create events, fixed teachers
-- are exempt from approval, and AI moderation must not fail open. A member's event is pending until it is
-- approved - by Saga against the explicit criteria, or by the board - and only an approved event is public.
ALTER TABLE room_bookings
ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'
CHECK (review_status IN ('pending', 'approved', 'needs_board', 'rejected'));

ALTER TABLE room_bookings ADD COLUMN review_note TEXT;
ALTER TABLE room_bookings ADD COLUMN reviewed_by TEXT;
ALTER TABLE room_bookings ADD COLUMN reviewed_at_ms INTEGER;

-- The bookings made before approval existed stay as they are.
UPDATE room_bookings SET review_status = 'approved', reviewed_by = 'Før godkendelse', reviewed_at_ms = updated_at_ms;

CREATE INDEX idx_room_bookings_review ON room_bookings(review_status, starts_at_ms);

-- The fixed teachers (explicit policy data, kept by the board): their events need no approval.
CREATE TABLE fixed_teachers (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at_ms INTEGER NOT NULL
) STRICT;

-- Requested: "Vi skal også forberede Saga til at kunne hjælpe med at sætte et event op." Saga's draft of an
-- event from what a board member writes; created in the new system when the board says so.
CREATE TABLE cockpit_event_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'created', 'discarded')),
  room_booking_id INTEGER,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_cockpit_event_drafts_status ON cockpit_event_drafts(status, updated_at_ms);
