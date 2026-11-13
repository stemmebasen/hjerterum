-- Asked (the chair, 12 Nov 2026), on Douglas' "The membership levels must be in the 'Membership Overview' page and editable": by the chair and
-- Douglas. A saved level is laid over the one written in membership.ts; a level with no row here is as written there.
CREATE TABLE IF NOT EXISTS membership_levels (
  tier TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  month_minor INTEGER NOT NULL CHECK (month_minor >= 0),
  year_minor INTEGER NOT NULL CHECK (year_minor >= 0),
  updated_at_ms INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
-- Every change, with who made it and what it was before.
CREATE TABLE IF NOT EXISTS membership_level_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  by_name TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS membership_level_changes_at ON membership_level_changes (at_ms DESC);
