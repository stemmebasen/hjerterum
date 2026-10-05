-- Photos and files on member events (requested): one cover photo that is public once the event is approved, and other files
-- (programme, practical information) that the organiser, the registered and the board can open. The bytes live in R2
-- (EVENT_MEDIA); this table says what each object is and which event it belongs to.
CREATE TABLE room_booking_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_booking_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cover', 'file')),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (room_booking_id) REFERENCES room_bookings(id) ON DELETE CASCADE
);

CREATE INDEX idx_room_booking_files_booking ON room_booking_files(room_booking_id);
-- An event has at most one cover photo.
CREATE UNIQUE INDEX idx_room_booking_files_cover ON room_booking_files(room_booking_id) WHERE kind = 'cover';
