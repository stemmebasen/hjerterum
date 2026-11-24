-- "Sendt post" in /admin (Jake 2026-11-24): every mail the site sends, with recipient, subject and the mail itself, so
-- the admin can see and open what went out. Written by sendMail (src/mail.ts), so every kind of mail is kept, also new
-- ones. Mails fetched from Resend's own log (sent before this table existed) have source 'resend'. Secret links in a
-- mail (login links) are hidden before it is saved. Kept for a year; a member's mails go when the member is deleted.
CREATE TABLE sent_mails (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL CHECK (length(to_email) <= 320),
  subject TEXT NOT NULL CHECK (length(subject) <= 300),
  html TEXT CHECK (html IS NULL OR length(html) <= 200000),
  text TEXT CHECK (text IS NULL OR length(text) <= 100000),
  reply_to TEXT CHECK (reply_to IS NULL OR length(reply_to) <= 320),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'off')),
  error TEXT CHECK (error IS NULL OR length(error) <= 300),
  provider_id TEXT CHECK (provider_id IS NULL OR length(provider_id) <= 100),
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'resend')),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sent_mails_created ON sent_mails (created_at);
CREATE INDEX sent_mails_to ON sent_mails (to_email);
CREATE UNIQUE INDEX sent_mails_provider ON sent_mails (provider_id) WHERE provider_id IS NOT NULL;
