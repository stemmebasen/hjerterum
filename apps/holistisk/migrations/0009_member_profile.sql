-- What the others in a flock (flok) see about a member: first name, age group (members.age_group, the column Samfolk
-- also uses) and one line about themselves. Signing up still needs only a first name; the age group and the line are
-- asked for the first time the member starts or joins a flock. A photo is optional, and only current members of a
-- flock the person is in can see it.

ALTER TABLE members ADD COLUMN intro TEXT CHECK (intro IS NULL OR length(intro) BETWEEN 3 AND 120);

-- One photo per member, made small in the browser before upload. `id` changes with every new photo, so a flock page's
-- link to an old photo stops working.
CREATE TABLE member_photos (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('image/jpeg', 'image/png', 'image/webp')),
  data BLOB NOT NULL CHECK (length(data) <= 250000),
  updated_at INTEGER NOT NULL
) STRICT;
