-- Reported by the chair: "There seemed to be a lot missing in the summary, even though I did record the whole meeting" - then:
-- "Begge skal laves igen og sendes ud til godkendelse igen. Implementer mine og andres rettelser først. ... Start med at sende dem til godkendelse hos mig."
-- Saga's answer was cut off at the token limit (saga/ai.ts), so the minutes of 15 and 29 October stop midway - without Beslutninger, Aftaler and Opgaver.
-- redo_requested_at_ms marks minutes Saga is to write again from the transcript (saga.ts redoMinutes): the points already written stay as they are
-- (the board's corrections are in them), the rest is written, and the chair reads them first - then the board corrects and approves them again.
ALTER TABLE board_minutes ADD COLUMN redo_requested_at_ms INTEGER;

-- 15 October was approved by the whole board and locked (0068). At the chair's request it is opened again: the lock is lifted once - the trigger
-- that guards it is dropped and made again exactly as before - and the sign-offs go, since the board approves the whole minutes again.
DROP TRIGGER board_minutes_locked_update;
UPDATE board_minutes SET locked_at_ms = NULL WHERE id = 14 AND meeting_date = '2026-10-15';
CREATE TRIGGER board_minutes_locked_update
BEFORE UPDATE OF draft_markdown, transcript, status, meeting_date, source, locked_at_ms ON board_minutes
WHEN OLD.locked_at_ms IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'minutes_locked');
END;

UPDATE board_minutes SET redo_requested_at_ms = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE (id = 14 AND meeting_date = '2026-10-15') OR (id = 15 AND meeting_date = '2026-10-29');
