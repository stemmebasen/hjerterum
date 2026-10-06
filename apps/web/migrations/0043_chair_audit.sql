-- The chair's powers will grow (cockpit/authority.ts). What is sensitive - reading other members' conversations, closing someone's access,
-- connecting the shared mailbox, forgetting what others taught Saga - is written down here: who, which power, and what it concerned.
CREATE TABLE chair_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  member TEXT NOT NULL,
  power TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE INDEX idx_chair_audit_at ON chair_audit(at_ms);
