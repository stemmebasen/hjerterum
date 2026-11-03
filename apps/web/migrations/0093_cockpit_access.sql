-- Requested (3 Nov 2026), after the security review: "Skal jeg rette punkt 1 til 7 nu" - "Ja".
-- 1. Admin knows a person by their Telegram account, not by the name they show there: a name used by another account gets no login.
-- 2. The chair decides who may log in: a Telegram account that asks for its first login after 4 Nov 2026 waits for the chair's Godkend.
CREATE TABLE IF NOT EXISTS cockpit_access (
  telegram_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('bestyrelse', 'suppleant')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  asked_at_ms INTEGER NOT NULL,
  decided_at_ms INTEGER
);
-- When a deputy was first seen in the deputies' group (seen_at_ms moves with every message).
ALTER TABLE cockpit_deputies ADD COLUMN first_seen_at_ms INTEGER;
UPDATE cockpit_deputies SET first_seen_at_ms = seen_at_ms WHERE first_seen_at_ms IS NULL;
