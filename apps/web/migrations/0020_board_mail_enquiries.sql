-- Requested: "Lav også plads til en ny underside: Forespørgsler. Her scanner Saga mailboksen for
-- Forespørgsler". Saga's reading of each team@ mail: whether it is an enquiry, what kind, one line
-- on who wants what - and who on the board has taken care of it.
ALTER TABLE board_mail ADD COLUMN scanned_at_ms INTEGER;
ALTER TABLE board_mail ADD COLUMN enquiry_kind TEXT;
ALTER TABLE board_mail ADD COLUMN enquiry_summary TEXT;
ALTER TABLE board_mail ADD COLUMN handled_at_ms INTEGER;
ALTER TABLE board_mail ADD COLUMN handled_by TEXT;

CREATE INDEX idx_board_mail_enquiries ON board_mail(enquiry_kind, handled_at_ms, received_at_ms);
