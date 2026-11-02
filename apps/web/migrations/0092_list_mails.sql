-- Requested: "Så jeg bliver i stand til at sende mails ud fra Board Admin til modtagerne?" - "Ja". A single mail to Hjerterum's Mailchimp list,
-- written (or drafted by Saga) and sent from admin (worker/list-mail.ts): to everyone in the list, or to the members only (the tag "Medlem").
-- Nothing is sent before the chair presses Send; a sent mail is kept as it went out.
CREATE TABLE list_mails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL DEFAULT '',
  preheader TEXT NOT NULL DEFAULT '',
  heading TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'alle' CHECK (audience IN ('alle', 'medlemmer')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'failed')),
  campaign_id TEXT,
  recipients INTEGER,
  error TEXT,
  created_by TEXT NOT NULL,
  sent_by TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  sent_at_ms INTEGER
) STRICT;
