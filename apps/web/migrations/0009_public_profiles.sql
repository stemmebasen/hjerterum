CREATE TABLE public_profiles (
  clerk_user_id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
  published_json TEXT CHECK(published_json IS NULL OR json_valid(published_json)),
  external_member_id INTEGER REFERENCES external_memberships(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  consent_at_ms INTEGER,
  updated_at_ms INTEGER NOT NULL
) STRICT;
