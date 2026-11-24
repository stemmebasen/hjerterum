-- Mails about membership (Jake 2026-11-24): "Velkommen som medlem" to new members ('welcome'), and one invitation to
-- become a member with a link, to those who have shown interest in an arrangement but are not members ('join').
-- mail_log keeps 'status' from 0018_status_mails.sql. SQLite cannot change a
-- CHECK, so the table is made again.
CREATE TABLE mail_log_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'invitation', 'reminder', 'status', 'welcome', 'join')),
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'off')),
  error TEXT CHECK (error IS NULL OR length(error) <= 300),
  created_at INTEGER NOT NULL
) STRICT;
INSERT INTO mail_log_new (id, kind, member_id, status, error, created_at) SELECT id, kind, member_id, status, error, created_at FROM mail_log;
DROP TABLE mail_log;
ALTER TABLE mail_log_new RENAME TO mail_log;
CREATE INDEX mail_log_created ON mail_log (created_at);

-- The invitation to become a member: one row per profile, so nobody gets it twice. The link's token is kept only as a
-- hash. `used_at` is when the link made them a member.
CREATE TABLE join_invites (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;
