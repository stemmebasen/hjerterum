-- Requested (the chair, 5 Nov 2026): "Det ville være rigtig fint, at der allerede er lavet en kobling til det pågældende event og at materialet, der er sendt
-- allerede ligger klar i den pågældende mappe under det pågældende event klar til brug." What a PR mail brought (pictures, documents, its own words), kept
-- with the event it is about - a calendar event ("mw:SF…") or the house's own ("hr:<n>") - for Plakater og opslag.
CREATE TABLE IF NOT EXISTS event_material (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  mail_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'file', 'text')),
  filename TEXT,
  content_type TEXT,
  r2_key TEXT,
  size_bytes INTEGER,
  text TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS event_material_event ON event_material (event_key, kind, id);
-- The event Saga (or the chair) linked the mail to, when its material was looked at, and the chair's "Skjul" in PR og SoMe → Mails.
ALTER TABLE board_mail ADD COLUMN pr_event_key TEXT;
ALTER TABLE board_mail ADD COLUMN pr_material_at_ms INTEGER;
ALTER TABLE board_mail ADD COLUMN pr_hidden_at_ms INTEGER;
