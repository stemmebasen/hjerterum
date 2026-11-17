-- Socialklubben's contact form (/kontakt): questions, ideas and organisers who want to be on the site. Each message
-- is kept here and mailed to the contact address with the sender as reply-to.
--
-- `sender` is a hash of the sender's IP address, only for limiting how many messages one sender can send; it is
-- cleared after a day by the nightly clean-up. `mail` says whether the message went out by e-mail: 'held' when the
-- day's mail budget for the form is used up (it is then only in the admin overview).
CREATE TABLE contact_messages (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL CHECK (topic IN ('spoergsmaal', 'arrangoer', 'ide', 'fejl', 'andet')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 5 AND 160),
  organisation TEXT CHECK (organisation IS NULL OR length(organisation) <= 120),
  website TEXT CHECK (website IS NULL OR length(website) <= 200),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 3000),
  sender TEXT,
  mail TEXT NOT NULL CHECK (mail IN ('sent', 'failed', 'off', 'held')),
  mail_error TEXT CHECK (mail_error IS NULL OR length(mail_error) <= 300),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX contact_messages_sender ON contact_messages (sender, created_at);
CREATE INDEX contact_messages_created ON contact_messages (created_at);
