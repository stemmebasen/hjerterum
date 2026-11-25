-- Unsubscribing from Socialklubben's mails (Jake 2026-11-25). One row per e-mail address that has been sent a mail with
-- an unsubscribe link: the link's token, and when the address unsubscribed (NULL while it still gets mails). The same
-- token lets the status mails' "fjern mig fra listen" link take that address's interest in one arrangement off the
-- list. Rows of unsubscribed addresses are kept, so nobody is written to again after saying no.
CREATE TABLE mail_prefs (
  email TEXT PRIMARY KEY CHECK (length(email) <= 320),
  token TEXT NOT NULL UNIQUE CHECK (length(token) BETWEEN 30 AND 60),
  unsubscribed_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;
