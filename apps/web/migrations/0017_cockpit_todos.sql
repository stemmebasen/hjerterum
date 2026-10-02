-- Requested: "vi skal have en påmindelsesliste / to do-liste, hvor man skal krydse af de opgaver der er
-- tildelt en. Man kan også selv skrive ind." A member's own items (or one written to another member),
-- and which of the minutes' tasks each member has checked off.
CREATE TABLE cockpit_todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  text TEXT NOT NULL,
  due TEXT,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  done_at_ms INTEGER
) STRICT;

CREATE INDEX idx_cockpit_todos_owner ON cockpit_todos(owner, done_at_ms);

CREATE TABLE cockpit_task_checks (
  owner TEXT NOT NULL,
  task_key TEXT NOT NULL,
  done_at_ms INTEGER NOT NULL,
  PRIMARY KEY (owner, task_key)
) STRICT;
