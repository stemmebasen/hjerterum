-- Requested (the chair, 3 Nov 2026): "Vi skal lave et PR-cockpit i admin, som kun formanden har adgang til i begyndelsen. Så vi skal have kontakt
-- til vores sociale medier." - the chair's own at first (docs/decisions/0007, authority.ts "social.manage"). Worker: worker/social/*.
--
-- Hjerterum's Facebook page and the Instagram account linked to it: connected by the chair in admin (Facebook Login), the page's own
-- access token kept sealed (like team@'s password). One account.
CREATE TABLE social_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  page_token_sealed TEXT NOT NULL,
  ig_user_id TEXT,
  ig_username TEXT,
  connected_by TEXT NOT NULL,
  connected_at_ms INTEGER NOT NULL,
  -- The last time the tags were read, and what went wrong then (shown in admin).
  checked_at_ms INTEGER,
  check_error TEXT
) STRICT;

-- Every post the PR cockpit makes - Saga drafts it, the chair approves it, the job publishes it at its time, once:
-- "share": a post someone tagged Hjerterum in, passed on; "event": one of the week's 7-10 events on Facebook; "week": "Ugens events".
-- source_key keeps a post from being made twice (the tagged post's id, or the week and the event).
CREATE TABLE social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('share', 'event', 'week')),
  source_key TEXT NOT NULL UNIQUE,
  week TEXT,
  channels TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(channels)),
  text TEXT NOT NULL DEFAULT '',
  link TEXT,
  images TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(images)),
  -- What was tagged (network, author, permalink, its own words, media) or the event (key, title, start).
  source TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source)),
  publish_at_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'publishing', 'published', 'failed', 'skipped')),
  approved_by TEXT,
  approved_at_ms INTEGER,
  -- Where it went: {"facebook": "<post id>", "instagram": "<media id>"}.
  published TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(published)),
  published_at_ms INTEGER,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_social_posts_due ON social_posts(status, publish_at_ms);
CREATE INDEX idx_social_posts_week ON social_posts(week, kind);
