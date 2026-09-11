-- Complete the event lifecycle without destroying registration history.

ALTER TABLE room_bookings
ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled'
CHECK (status IN ('scheduled', 'cancelled'));

ALTER TABLE room_bookings
ADD COLUMN cancelled_at_ms INTEGER;

CREATE INDEX idx_room_bookings_status_time
ON room_bookings(status, starts_at_ms);
