-- Requested: "Vi skal også finde plads til et nyt punkt - \"Opret forslag til afstemning\". Man kan komme med et forslag,
-- og så kan bestyrelsesmedlemmerne digitalt stemme for det. Ved flertal er forslaget vedtaget. Når et forslag er stillet,
-- skal hvert bestyrelsesmedlem have punktet på sin to do."
CREATE TABLE board_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  -- The board's size when the proposal was made: a majority is more than half of it.
  members INTEGER NOT NULL CHECK (members > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'adopted', 'rejected', 'withdrawn')),
  deadline_ms INTEGER NOT NULL,
  decided_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_board_proposals_status ON board_proposals(status, deadline_ms);

CREATE TABLE board_votes (
  proposal_id INTEGER NOT NULL REFERENCES board_proposals(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('for', 'imod', 'undlader')),
  voted_at_ms INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, voter)
) STRICT;
