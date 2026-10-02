-- Requested: "Der bør vær en engelsk oversættelses knap - Douglas taler engelsk" - "Ja byg det sådan".
-- Each member's language in the cockpit, and Saga's kept translations (by the Danish text's SHA-256).
CREATE TABLE cockpit_prefs (
  member TEXT PRIMARY KEY,
  lang TEXT NOT NULL DEFAULT 'da' CHECK (lang IN ('da', 'en')),
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE cockpit_translations (
  source_hash TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('en')),
  text TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (source_hash, lang)
) STRICT;
