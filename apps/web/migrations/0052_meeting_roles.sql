-- Requested: "Der skal i øvrigt kunne vælges en Mødeleder og Ordstyrer." - a meeting's leader and moderator (ordstyrer), chosen among the board; NULL until someone picks.
ALTER TABLE board_meetings ADD COLUMN leader TEXT;
ALTER TABLE board_meetings ADD COLUMN moderator TEXT;
