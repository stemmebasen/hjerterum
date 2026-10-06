-- Requested: delete the audio of a meeting once the minutes are made - only for what is uploaded or recorded in the cockpit (kept in R2).
-- The transcript and the minutes stay on the row; this marks that the audio itself is gone (saga/recordingRetention.ts).
ALTER TABLE board_minutes ADD COLUMN audio_deleted_at_ms INTEGER;
