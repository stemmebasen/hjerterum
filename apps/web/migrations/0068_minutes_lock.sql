-- Requested: "Når et referat er blevet godkendt af alle bestyrelsesmedlemmer, skal det låses fast, ingen ændringer mulige."
-- locked_at_ms is set once every board member has approved. From then on the database itself refuses any change to the
-- text, the approval or the sign-offs - whatever path tries it.
ALTER TABLE board_minutes ADD COLUMN locked_at_ms INTEGER;

CREATE TRIGGER board_minutes_locked_update
BEFORE UPDATE OF draft_markdown, transcript, status, meeting_date, source, locked_at_ms ON board_minutes
WHEN OLD.locked_at_ms IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'minutes_locked');
END;

CREATE TRIGGER board_minutes_locked_delete
BEFORE DELETE ON board_minutes
WHEN OLD.locked_at_ms IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'minutes_locked');
END;

CREATE TRIGGER board_minutes_signoffs_locked_update
BEFORE UPDATE ON board_minutes_signoffs
WHEN (SELECT locked_at_ms FROM board_minutes WHERE id = OLD.minutes_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'minutes_locked');
END;

CREATE TRIGGER board_minutes_signoffs_locked_delete
BEFORE DELETE ON board_minutes_signoffs
WHEN (SELECT locked_at_ms FROM board_minutes WHERE id = OLD.minutes_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'minutes_locked');
END;
