-- Requested: "Det er denne prisberegners data alt skal baseres på https://holistisk.org/lejepriser/".
-- The calculator's booking type: standard (package price), reduced (member discount) or free rent.
-- It sets the room fee and which rules hold (no weekday booking across 18:30 with discount or free rent).
ALTER TABLE room_bookings
ADD COLUMN booking_type TEXT NOT NULL DEFAULT 'standard'
CHECK (booking_type IN ('standard', 'reduced', 'free'));
