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


CREATE TABLE member_access_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('hjerterum', 'membershipworks')),
  source_member_id INTEGER NOT NULL,
  blocked INTEGER NOT NULL CHECK (blocked IN (0, 1)),
  changed_by_email TEXT NOT NULL,
  changed_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_member_access_changes_member
ON member_access_changes(source, source_member_id, changed_at_ms);
