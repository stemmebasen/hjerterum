-- Requested: "Mødeoverskrift: Torsdag d. 15. oktober kl. 13.30-15.30". When a meeting ends, as HH:MM; NULL when not set
-- (a team meeting is then taken to last two hours).
ALTER TABLE board_meetings ADD COLUMN end_time TEXT;
