-- Requested: "Referatet skal op uden godkendelse, men alle medlemmer skal pinges til at godkende
-- referatet". Each board member's sign-off on a minutes, or the correction they ask for.
CREATE TABLE board_minutes_signoffs (
  minutes_id INTEGER NOT NULL REFERENCES board_minutes(id) ON DELETE CASCADE,
  member TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approved', 'correction')),
  comment TEXT,
  at_ms INTEGER NOT NULL,
  PRIMARY KEY (minutes_id, member)
) STRICT;
