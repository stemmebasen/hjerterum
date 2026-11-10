-- Indmeldelser: people who sign up as members of the association. A profile is not needed: you can be a member
-- without taking part in outings. Payment is not open yet, so this records the sign-up (name + e-mail) so we can
-- write to them when it opens.

CREATE TABLE membership_signups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 5 AND 160),
  created_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX membership_signups_email ON membership_signups (lower(email));
