-- Requested: "Lav gerne flere skabeloner" - "Så der er 15 i alt" - "Nej, 8 der vises. Og så kan man få 8 nye."
-- The poster designs grew from five to sixteen. poster_variant's CHECK only knows the first five, and SQLite cannot change a
-- CHECK without rebuilding room_bookings, so the choice moves to a new column, checked in code (site/poster-rules.ts POSTER_DESIGNS).
-- poster_variant is left as it is and no longer written.
ALTER TABLE room_bookings ADD COLUMN poster_design TEXT;
UPDATE room_bookings SET poster_design = poster_variant WHERE poster_variant IS NOT NULL;
