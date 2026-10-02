-- Requested: "Til et forslag skal et medlem kunne notere: Jeg ønsker at drøfte dette på et møde".
CREATE TABLE board_vote_discuss (
  proposal_id INTEGER NOT NULL REFERENCES board_proposals(id) ON DELETE CASCADE,
  member TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, member)
) STRICT;
