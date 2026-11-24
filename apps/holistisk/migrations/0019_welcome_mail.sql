-- "Velkommen som medlem" mails (Jake 2026-11-24): mail_log gets the kind 'welcome'. It keeps 'status' from
-- 0018_status_mails.sql, so this file must run after that one. SQLite cannot change a CHECK, so the table is made again.
CREATE TABLE mail_log_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('login', 'invitation', 'reminder', 'status', 'welcome')),
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'off')),
  error TEXT CHECK (error IS NULL OR length(error) <= 300),
  created_at INTEGER NOT NULL
) STRICT;
INSERT INTO mail_log_new (id, kind, member_id, status, error, created_at) SELECT id, kind, member_id, status, error, created_at FROM mail_log;
DROP TABLE mail_log;
ALTER TABLE mail_log_new RENAME TO mail_log;
CREATE INDEX mail_log_created ON mail_log (created_at);
