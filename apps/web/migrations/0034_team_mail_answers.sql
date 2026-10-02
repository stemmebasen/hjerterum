-- Asked: "hvordan ved Saga, at de ikke er besvaret?" - "Hun er nødt til at tjekke, om der er kommet svar i mailboksen".
-- Each kept mail remembers where it lies in team@ (folder, UID) and its Message-ID and reply address, so Saga can see it
-- answered: marked answered in the mailbox, put in a folder "Besvarede", or a mail in Sent that replies to it. Sent mail
-- is kept only as the envelope (to whom, subject, which mail it answers) - never shown.
ALTER TABLE board_mail ADD COLUMN message_id TEXT;
ALTER TABLE board_mail ADD COLUMN reply_address TEXT;
ALTER TABLE board_mail ADD COLUMN folder TEXT;
ALTER TABLE board_mail ADD COLUMN uid_validity TEXT;
ALTER TABLE board_mail ADD COLUMN uid INTEGER;
ALTER TABLE board_mail ADD COLUMN answered_at_ms INTEGER;
ALTER TABLE board_mail ADD COLUMN answered_how TEXT;
CREATE INDEX idx_board_mail_message_id ON board_mail(message_id);

CREATE TABLE team_mail_sent (
  ref TEXT PRIMARY KEY,
  message_id TEXT,
  in_reply_to TEXT,
  refs TEXT,
  recipients TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_team_mail_sent_at ON team_mail_sent(sent_at_ms);
