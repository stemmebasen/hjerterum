-- Requested: "Jeg skal ikke se mails. Jeg skal have overordnet resume" - Saga's overall picture of
-- the board (its Telegram group, team@ mail and the minutes document), written a few times a day
-- for the chair, and the last outcome of each outside service she depends on, so the chair's page
-- can say plainly whether the group, the document and the AI are connected.

CREATE TABLE board_overviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE saga_status (
  key TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  detail TEXT,
  at_ms INTEGER NOT NULL
) STRICT;
