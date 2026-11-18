-- E-mail from Socialklubben: login by a link sent on e-mail, and a notice when a flock place is offered.

-- A login link: a random token (only its SHA-256 is kept), for one e-mail address. `member_id` is the profile it logs
-- into; it is NULL for someone who signed up as a member (membership_signups) without a profile, whose profile is made
-- when the link is used. A link works once, until `expires_at`.
CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL CHECK (length(email) BETWEEN 5 AND 160),
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  next TEXT CHECK (next IS NULL OR length(next) <= 200),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;
CREATE INDEX login_links_email ON login_links (email, created_at);

-- When the reminder about an unanswered flock place was mailed (event_interests.notified_at is the first mail).
ALTER TABLE event_interests ADD COLUMN reminded_at INTEGER;

-- What was sent, for counting and finding faults. The address itself is not kept here.
CREATE TABLE mail_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'invitation', 'reminder')),
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'off')),
  error TEXT CHECK (error IS NULL OR length(error) <= 300),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX mail_log_created ON mail_log (created_at);
