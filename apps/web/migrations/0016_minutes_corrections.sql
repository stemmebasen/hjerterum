-- Requested: "Der skal ved hvert punkt være mulighed for hvert medlem af indsende rettelse - herefter
-- vil Saga omskrive punktet. Hun skal spørge hvis hun er usikker på hvad der menes."
CREATE TABLE board_minutes_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  minutes_id INTEGER NOT NULL REFERENCES board_minutes(id) ON DELETE CASCADE,
  point INTEGER NOT NULL CHECK (point >= 1),
  member TEXT NOT NULL,
  correction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'question', 'failed')),
  question TEXT,
  answer TEXT,
  note TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_board_minutes_corrections_minutes ON board_minutes_corrections(minutes_id, point);
CREATE INDEX idx_board_minutes_corrections_status ON board_minutes_corrections(status, updated_at_ms);
