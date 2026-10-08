-- Requested: "Holder hun også øje med mails om der er nogen der er kritiske og vi skal forholde os til hurtigst muligt" - "Bare mig nu".
-- Saga's scan of team@ also judges every new mail for urgency: why it is critical (NULL = not), and when the chair was told on Telegram.
ALTER TABLE board_mail ADD COLUMN urgent_why TEXT;
ALTER TABLE board_mail ADD COLUMN urgent_notified_ms INTEGER;
CREATE INDEX idx_board_mail_urgent ON board_mail(urgent_why, urgent_notified_ms);
