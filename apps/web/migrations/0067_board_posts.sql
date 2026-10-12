-- Requested (Gitta): "et slags åbent fora næsten som en opslagstavle for bestyrelsen ... hvor vi lige kan tage et emne op eller hurtige beslutninger sammen.
-- Stille noget op til afstemning/afklaring/beslutning som ikke behøver være til et møde. Så kun det vigtigste når med til mødet."
-- The votes stay in board_proposals; the board's other posts - a question to settle, or a matter for their information - are here.
CREATE TABLE board_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('afklaring', 'orientering')),
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  outcome TEXT,
  closed_by TEXT,
  closed_at_ms INTEGER,
  -- "Til mødet": who asked, and the meeting whose agenda it was put on.
  for_meeting_by TEXT,
  meeting_id INTEGER
);
CREATE TABLE board_post_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX board_post_replies_post ON board_post_replies (post_id, created_at_ms);
CREATE TABLE board_post_seen (
  post_id INTEGER NOT NULL,
  member TEXT NOT NULL,
  seen_at_ms INTEGER NOT NULL,
  PRIMARY KEY (post_id, member)
);
