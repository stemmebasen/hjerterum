-- Asked: "Hun skal kunne rette: Teammødets deltagere: Jacob, Douglas, Frederik, Gitta, Lisbeth, Line (suppleant)" - "gør det muligt at rette det manuelt
-- fremover". Who took part in a meeting, as written by the board (or Saga when asked); the minutes take their "Til stede" from it.
ALTER TABLE board_meetings ADD COLUMN attendees TEXT;
