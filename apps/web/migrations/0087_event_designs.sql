-- Requested: "Hvorfor vises der ikke det flotte layout i det aflange eventfoto? Det giver jo mening, at det er vores nye design,
-- der skal være overalt på hjemmesiden og ikke kun på sociale medier". The chosen design drawn as the event's wide picture
-- (1920 × 1005) in the browser when the event is saved; the site shows it instead of the bare photo, which the designs keep using.
CREATE TABLE room_booking_designs (
  room_booking_id INTEGER PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (room_booking_id) REFERENCES room_bookings(id) ON DELETE CASCADE
) STRICT;
