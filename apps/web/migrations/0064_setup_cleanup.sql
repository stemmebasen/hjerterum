-- Requested: "Tidligere har man skullet booke tid til klargøring og rengøring lidt tid før og efter eventet" - "Ja" to 30 minutes before
-- and after by default. starts_at_ms/ends_at_ms stay the event's own time (what the calendar shows); the room is taken from
-- starts_at_ms - setup to ends_at_ms + cleanup, and the rent is for that time.
ALTER TABLE room_bookings ADD COLUMN setup_minutes INTEGER NOT NULL DEFAULT 0 CHECK (setup_minutes IN (0, 30, 60));
ALTER TABLE room_bookings ADD COLUMN cleanup_minutes INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_minutes IN (0, 30, 60));
