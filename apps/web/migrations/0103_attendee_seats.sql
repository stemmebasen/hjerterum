-- Douglas (13 Nov 2026), for the board: "Can there be the possibility to book more than one person when booking for an event?"
-- How many places one sign-up holds (the one who signs up and those they bring).
ALTER TABLE room_booking_attendees ADD COLUMN seats INTEGER NOT NULL DEFAULT 1 CHECK (seats >= 1 AND seats <= 10);
