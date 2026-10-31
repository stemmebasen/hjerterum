-- Requested: "Saga skal også spørge om interesserede må kontakte underviseren - man kan vælge email, telefon eller begge dele".
-- NULL: no contact shown. The address and number come from the organiser's own member profile when the event is shown.
ALTER TABLE room_bookings ADD COLUMN contact_share TEXT CHECK (contact_share IS NULL OR contact_share IN ('email', 'phone', 'both'));
