-- Requested: "I would like to add an intelligent and clever AI call once per day that looks through it all and tidies up and catches duplets,
-- irrelevant or outdated information and just makes sure the admin is nicely kept." - "Ja". What Saga's nightly tidy-up found: a duplicate to-do
-- she closed herself ('gjort', which the chair can undo), and the rest as suggestions for the chair ('forslag' until 'gjort' or 'afvist').
CREATE TABLE cleanup_actions (
  id INTEGER PRIMARY KEY,
  run_day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('dublet', 'klaret', 'forældet')),
  target TEXT NOT NULL,
  text TEXT NOT NULL,
  why TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('gjort', 'forslag', 'afvist', 'fortrudt')),
  created_at_ms INTEGER NOT NULL,
  decided_by TEXT,
  decided_at_ms INTEGER
) STRICT;
CREATE INDEX idx_cleanup_actions_target ON cleanup_actions(target, created_at_ms);
CREATE INDEX idx_cleanup_actions_day ON cleanup_actions(run_day, status);
