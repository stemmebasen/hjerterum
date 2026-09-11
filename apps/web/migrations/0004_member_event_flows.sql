-- Complete the event lifecycle without destroying registration history.

ALTER TABLE room_bookings
ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled'
CHECK (status IN ('scheduled', 'cancelled'));

ALTER TABLE room_bookings
ADD COLUMN cancelled_at_ms INTEGER;

CREATE INDEX idx_room_bookings_status_time
ON room_bookings(status, starts_at_ms);

-- Access blocks are independent of billing/source status and can be reversed by admin.
ALTER TABLE members
ADD COLUMN access_blocked INTEGER NOT NULL DEFAULT 0
CHECK (access_blocked IN (0, 1));

ALTER TABLE external_memberships
ADD COLUMN access_blocked INTEGER NOT NULL DEFAULT 0
CHECK (access_blocked IN (0, 1));
