-- Requested: "Bestyrelsen lige nu" - "Her skal Saga en gang i timen lave et resume og overblik over hvad der
-- rører sig netop nu med basis i Telegram, vigtige mails og fra mødet (hvis det er mindre end 48 timer siden)".
CREATE TABLE board_now (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  newest_source_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_board_now_created ON board_now(created_at_ms);
