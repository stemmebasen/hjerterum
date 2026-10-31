-- Requested: "Når man opretter event skal man også kunne vælge en af skabelonerne eller alternativt uploade sit eget".
-- The design the organiser chose for the event's social-media poster (src/event-poster.ts): NULL lets the system choose,
-- 'eget' means their own poster below. Their own poster is checked by Saga before it is kept (worker/event-posters.ts).
ALTER TABLE room_bookings ADD COLUMN poster_variant TEXT CHECK (poster_variant IS NULL OR poster_variant IN ('rolig', 'foto', 'organisk', 'typografi', 'split', 'eget'));

CREATE TABLE room_booking_posters (
  room_booking_id INTEGER PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  saga_note TEXT,
  uploaded_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (room_booking_id) REFERENCES room_bookings(id) ON DELETE CASCADE
) STRICT;
