-- English pages (Jake 2026-11-18, "og selve eventet"): an arrangement's title and description, machine-translated from
-- Danish once and kept here (src/i18n/machine.ts). source_hash is the Danish text it was made from: when the organiser
-- changes the text, it is translated again. title_en is NULL when the title stays as it is (a name, or already English);
-- description_en is NULL when there was nothing to translate. status 'kept' means the text was not Danish.
CREATE TABLE event_translations (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('translated', 'kept')),
  title_en TEXT,
  description_en TEXT,
  model TEXT,
  translated_at INTEGER NOT NULL
) STRICT;
