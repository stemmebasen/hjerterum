-- Informationsmødet (Jake 2026-11-24): sign-ups for the information meeting on 12 January 2027 (src/flokken/infoMeeting.ts).
-- `steering` is 1 when the person ticked that they might like to join the steering group (it commits them to nothing).
-- `mail` says whether the confirmation went out: 'held' when the day's mail budget for the form was used up.
CREATE TABLE info_meeting_signups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 5 AND 160),
  steering INTEGER NOT NULL DEFAULT 0 CHECK (steering IN (0, 1)),
  mail TEXT NOT NULL CHECK (mail IN ('sent', 'failed', 'off', 'held')),
  mail_error TEXT CHECK (mail_error IS NULL OR length(mail_error) <= 300),
  created_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX info_meeting_signups_email ON info_meeting_signups (lower(email));
