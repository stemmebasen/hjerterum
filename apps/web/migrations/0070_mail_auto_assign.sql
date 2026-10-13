-- Requested: "Is it possible that Saga learns or checks the email (the IMAP) to see if there is a contact person from the team that
-- normally deals with this sender, and then assigns that email automatically to that person?" - "Ja."
-- Who an answer from team@ came from (the sender name the mail program puts on it), who answered a mail, and why Saga assigned one
-- (NULL when a member did; 'fravalgt' when a member took Saga's choice away - she then leaves that mail alone).
ALTER TABLE team_mail_sent ADD COLUMN from_name TEXT;
ALTER TABLE board_mail ADD COLUMN answered_by TEXT;
ALTER TABLE board_mail ADD COLUMN assigned_why TEXT;
