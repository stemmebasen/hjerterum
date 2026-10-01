-- Requested: "Lad os bygge cockpit.hjerterum.info for bestyrelsen. Her er der styr på referater og
-- dagsorden. Samt et overblik ... både generelt og personligt (f.eks. personlige todos) - baseret
-- på hvem der er logget ind." - "Til start laver vi bare ét samlet login".

-- The board's meetings: date, time, place and agenda (one item per line), written in the cockpit.
CREATE TABLE board_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_date TEXT NOT NULL,
  start_time TEXT,
  place TEXT,
  agenda TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  updated_by TEXT
) STRICT;

CREATE INDEX idx_board_meetings_date ON board_meetings(meeting_date);

-- A recording uploaded in the cockpit ("upload referat (mp3/m4a)") is a third source for minutes.
-- SQLite cannot widen a CHECK constraint, so the table is rebuilt with every row kept as it is.
CREATE TABLE board_minutes_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('telegram', 'drive', 'upload')),
  source_file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'transcribing', 'drafted', 'approved', 'rejected', 'failed')),
  meeting_date TEXT,
  transcript TEXT,
  draft_markdown TEXT,
  approval_message_id INTEGER,
  drive_document_id TEXT,
  drive_document_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_error TEXT,
  UNIQUE (source, source_file_id)
) STRICT;

INSERT INTO board_minutes_next (id, source, source_file_id, file_name, mime_type, status, meeting_date, transcript, draft_markdown,
  approval_message_id, drive_document_id, drive_document_url, attempts, created_at_ms, updated_at_ms, last_error)
SELECT id, source, source_file_id, file_name, mime_type, status, meeting_date, transcript, draft_markdown,
  approval_message_id, drive_document_id, drive_document_url, attempts, created_at_ms, updated_at_ms, last_error FROM board_minutes;

DROP TABLE board_minutes;
ALTER TABLE board_minutes_next RENAME TO board_minutes;
CREATE INDEX idx_board_minutes_status ON board_minutes(status, created_at_ms);

-- Failed logins with the board's shared password, counted per address and quarter of an hour.
CREATE TABLE cockpit_login_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  at_ms INTEGER NOT NULL
) STRICT;
