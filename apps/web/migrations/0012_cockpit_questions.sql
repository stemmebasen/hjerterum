-- Requested: "Saga skal også være tilgængelig i chat (højre bund), så man kan spørge hende om alt fra
-- vedtægter, beslutninger, sager, events og medlemmer". Each question asked in the board cockpit,
-- kept 90 days: for the daily limit on AI calls, and so the chair can see what the board asks.
CREATE TABLE cockpit_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asked_by TEXT,
  question TEXT NOT NULL,
  answer TEXT,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_cockpit_questions_created ON cockpit_questions(created_at_ms);
