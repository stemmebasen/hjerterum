-- Requested: "Rettelser til referat punkter skal ikke gemmes efter at det specifikke referat er godkendt."
-- When the whole board has approved a set of minutes and they lock (0068), the corrections sent to its points are deleted -
-- the ones Saga made, the open questions and the ones she could not make. From then on the database refuses to keep a new one,
-- whatever path tries it. The minutes text itself already holds what was corrected.

CREATE TRIGGER board_minutes_corrections_cleared_on_lock
AFTER UPDATE OF locked_at_ms ON board_minutes
WHEN OLD.locked_at_ms IS NULL AND NEW.locked_at_ms IS NOT NULL
BEGIN
  DELETE FROM board_minutes_corrections WHERE minutes_id = NEW.id;
END;

CREATE TRIGGER board_minutes_corrections_locked_insert
BEFORE INSERT ON board_minutes_corrections
WHEN (SELECT locked_at_ms FROM board_minutes WHERE id = NEW.minutes_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'minutes_locked');
END;

CREATE TRIGGER board_minutes_corrections_locked_update
BEFORE UPDATE ON board_minutes_corrections
WHEN (SELECT locked_at_ms FROM board_minutes WHERE id = OLD.minutes_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'minutes_locked');
END;

-- Minutes that are already locked: their corrections go now.
DELETE FROM board_minutes_corrections WHERE minutes_id IN (SELECT id FROM board_minutes WHERE locked_at_ms IS NOT NULL);
