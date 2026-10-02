-- Requested: "Hun skal læse alle relevante mails fra både hovedmappen og undermapper". Saga reads every folder of team@
-- except Sent, Drafts, Trash and Junk; each folder keeps its own watermark (the last IMAP UID read). The inbox's
-- watermark moves here from team_mail_account, whose uid_validity and last_uid are no longer read.
CREATE TABLE team_mail_folders (
  path TEXT PRIMARY KEY,
  uid_validity TEXT NOT NULL,
  last_uid INTEGER NOT NULL,
  checked_at_ms INTEGER NOT NULL
) STRICT;

INSERT INTO team_mail_folders (path, uid_validity, last_uid, checked_at_ms)
  SELECT 'INBOX', uid_validity, last_uid, connected_at_ms FROM team_mail_account
  WHERE id = 1 AND uid_validity IS NOT NULL AND last_uid IS NOT NULL;
