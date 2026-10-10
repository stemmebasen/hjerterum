-- Requested: setup and cleanup in quarters - 15, 30, 45 or 60 minutes (and none). 0064 allowed only 0, 30 and 60, and a
-- column's CHECK cannot be changed in place, so the columns are dropped and added again, keeping what is stored.
CREATE TABLE room_booking_buffers_keep AS SELECT id, setup_minutes, cleanup_minutes FROM room_bookings;
ALTER TABLE room_bookings DROP COLUMN setup_minutes;
ALTER TABLE room_bookings DROP COLUMN cleanup_minutes;
ALTER TABLE room_bookings ADD COLUMN setup_minutes INTEGER NOT NULL DEFAULT 0 CHECK (setup_minutes IN (0, 15, 30, 45, 60));
ALTER TABLE room_bookings ADD COLUMN cleanup_minutes INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_minutes IN (0, 15, 30, 45, 60));
UPDATE room_bookings SET
  setup_minutes = COALESCE((SELECT k.setup_minutes FROM room_booking_buffers_keep k WHERE k.id = room_bookings.id), 0),
  cleanup_minutes = COALESCE((SELECT k.cleanup_minutes FROM room_booking_buffers_keep k WHERE k.id = room_bookings.id), 0);
DROP TABLE room_booking_buffers_keep;
