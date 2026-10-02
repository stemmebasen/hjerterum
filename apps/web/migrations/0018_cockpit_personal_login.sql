-- Requested: "Hvordan kan vi sikre os, at kontoen, når først den er identificeret, bliver låst fast til
-- den enkelte bruger?" - "1." (a personal login link from Saga). A link is asked for in a private
-- Telegram chat with Saga, works once within 15 minutes, and logs in as that board member only.
CREATE TABLE cockpit_login_links (
  token_hash TEXT PRIMARY KEY,
  member TEXT NOT NULL,
  telegram_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  used_at_ms INTEGER
) STRICT;

-- The chair closes a member's access: every personal login of theirs from before this time ends.
CREATE TABLE cockpit_signouts (
  member TEXT PRIMARY KEY,
  after_ms INTEGER NOT NULL
) STRICT;
