-- Requested (Gitta, via the chair): "At de udtrykkeligt bliver opfordret til at dele minimun 3 billeder af dem selv/relevante billeder til PR. At det ligger
-- inde på deres siden. At de vinger noget ala det her af: 'Må bruges til mit nuværende og mine fremtidige events ... indtil jeg trækker mit samtykke
-- tilbage'" - and "Citater til brug i PR". A teacher's PR material: their photos, three short quotes, and their consent - given and withdrawn, with when.
CREATE TABLE pr_material (
  clerk_user_id TEXT PRIMARY KEY,
  quotes_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(quotes_json)),
  consent_at_ms INTEGER,
  withdrawn_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE pr_photos (
  id TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_pr_photos_owner ON pr_photos(clerk_user_id, created_at_ms);
