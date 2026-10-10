-- Requested: "Medlemsbesparelse xxx kr. siden <dato>" - what a non-member pays for the event, so a member's saving can be counted.
ALTER TABLE room_bookings ADD COLUMN non_member_price_minor INTEGER CHECK (non_member_price_minor IS NULL OR non_member_price_minor >= 0);
