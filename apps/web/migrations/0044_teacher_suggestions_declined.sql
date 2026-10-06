-- Undervisere: the system finds suggestions for a teacher's mail or phone number (cockpit/teacherSuggestions.ts); the board accepts or declines each one.
-- A declined suggestion is kept here, so it does not come back.
CREATE TABLE cockpit_teacher_declined (
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mail', 'telefon')),
  value TEXT NOT NULL,
  declined_by TEXT,
  declined_at_ms INTEGER NOT NULL,
  PRIMARY KEY (key, kind, value)
) STRICT;
