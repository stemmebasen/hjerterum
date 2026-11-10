-- Støttemedlemmer: people who want to support the association without taking part in outings. Payment is not open
-- yet, so this only records the wish (name + e-mail) so we can write to them when membership opens.

CREATE TABLE supporter_signups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 5 AND 160),
  created_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX supporter_signups_email ON supporter_signups (lower(email));
