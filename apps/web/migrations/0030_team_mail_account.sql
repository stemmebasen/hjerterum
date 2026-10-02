-- Requested: "medmindre det er mere optimalt at oprette den i hjerterums admin?" - "Godt". Hjerterum reads its own
-- mailbox (team@) itself: the chair connects it in the cockpit, the password is kept sealed, and Saga reads the inbox
-- every run - read-only, never sending. One account; the watermark is the last IMAP UID read.
CREATE TABLE team_mail_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  address TEXT NOT NULL,
  imap_host TEXT NOT NULL,
  password_sealed TEXT NOT NULL,
  uid_validity TEXT,
  last_uid INTEGER,
  connected_by TEXT NOT NULL,
  connected_at_ms INTEGER NOT NULL
) STRICT;
