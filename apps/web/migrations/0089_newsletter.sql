-- Requested: "this is how the newsletter should be designed and compiled each month, sent out on the first" (worker/newsletter.ts).
-- One issue per month: Saga's words (subject, intro, highlights, the list's short titles); the list itself is read from the
-- calendar when the issue is shown or sent. Sent only after a board member has approved it.
CREATE TABLE newsletter_issues (
  month TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  preheader TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL,
  highlights TEXT NOT NULL DEFAULT '[]',
  titles TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by TEXT,
  approved_at_ms INTEGER,
  campaign_id TEXT,
  sent_at_ms INTEGER,
  error TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;
