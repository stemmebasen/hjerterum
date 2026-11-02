-- Requested: "Jeg vil gerne have at alle modtagere gemmes samlet i vores Mailchimp konto" - "Alt med samtykke i én liste".
-- Everyone who has said yes to the newsletter, wherever they said it, on their way into the one Mailchimp audience (worker/mailchimp-sync.ts):
-- members from MembershipWorks who ticked "Receive newsletter", members who turn it on in Min profil, and guests who tick it when they sign up
-- for an event (they confirm their e-mail through Mailchimp first: double_opt_in). A row is sent once; a change sends it again.
CREATE TABLE mailchimp_contacts (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('membershipworks', 'member', 'event')),
  member INTEGER NOT NULL DEFAULT 0,
  double_opt_in INTEGER NOT NULL DEFAULT 0,
  queued_at_ms INTEGER NOT NULL,
  synced_at_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT
) STRICT;
CREATE INDEX idx_mailchimp_contacts_unsynced ON mailchimp_contacts(synced_at_ms, attempts);
