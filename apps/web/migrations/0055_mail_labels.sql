-- Requested: "I Posthus kan du lave forskellige mærkater, for eksempel medlem, event, generel og økonomi, og gøre det muligt at sortere under de forskellige mærkater."
-- Saga gives every mail in team@ one label (Medlem, Event, Økonomi, Generel, Automatisk); a member can change it. NULL = not labelled yet.
ALTER TABLE board_mail ADD COLUMN label TEXT;
CREATE INDEX idx_board_mail_label ON board_mail(label, received_at_ms);
