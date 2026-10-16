-- Requested: "Saga skal en gang i døgnet sørge for oprydning i systemet og slette eventuelle dubletter, spam, og andet der ligger og roder
-- unødvendigt." What she puts away as spam or system mail is a kind of its own ('spam'). SQLite cannot change a CHECK, so the table is rebuilt.
CREATE TABLE cleanup_actions_new (
  id INTEGER PRIMARY KEY,
  run_day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('dublet', 'klaret', 'forældet', 'spam')),
  target TEXT NOT NULL,
  text TEXT NOT NULL,
  why TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('gjort', 'forslag', 'afvist', 'fortrudt')),
  created_at_ms INTEGER NOT NULL,
  decided_by TEXT,
  decided_at_ms INTEGER
) STRICT;
INSERT INTO cleanup_actions_new (id, run_day, kind, target, text, why, status, created_at_ms, decided_by, decided_at_ms)
  SELECT id, run_day, kind, target, text, why, status, created_at_ms, decided_by, decided_at_ms FROM cleanup_actions;
DROP TABLE cleanup_actions;
ALTER TABLE cleanup_actions_new RENAME TO cleanup_actions;
CREATE INDEX idx_cleanup_actions_target ON cleanup_actions(target, created_at_ms);
CREATE INDEX idx_cleanup_actions_day ON cleanup_actions(run_day, status);
