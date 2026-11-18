-- Douglas (18 Nov 2026), for the board: "I cannot see any way to book a whole weekend." An event on several days in a row with the same times
-- each day: starts_at is the first day's start, ends_at the last day's end, and the room is rented (and checked for conflicts) day by day.
ALTER TABLE room_bookings ADD COLUMN days INTEGER NOT NULL DEFAULT 1 CHECK (days >= 1 AND days <= 7);
