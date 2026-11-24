-- Asked (the chair, 24 Nov 2026): "Jeg får en masse feedback fra Douglas. Er det muligt han på en eller måde kan chatte med ai om ændringerne - og så
-- ligger den endelig implementering og godkendelse stadig hos mig?" - "Ja". Admin → Ønsker og fejl (cockpit/wishes.ts): a conversation with Saga that
-- ends in one clear wish, which the chair approves or turns down.
CREATE TABLE IF NOT EXISTS wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL,
  -- open: being talked through with Saga; sent: waiting for the chair; approved; rejected; done: made and live.
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT,
  summary TEXT,
  chair_note TEXT,
  decided_by TEXT,
  decided_at_ms INTEGER,
  sent_at_ms INTEGER,
  done_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wishes_status ON wishes (status, updated_at_ms);

CREATE TABLE IF NOT EXISTS wish_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  -- person: the one who wishes; saga: Saga's answer.
  role TEXT NOT NULL,
  author TEXT,
  text TEXT NOT NULL,
  image_key TEXT,
  image_type TEXT,
  at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wish_messages_wish ON wish_messages (wish_id, id);
