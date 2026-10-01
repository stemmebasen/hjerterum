-- Requested: "En sjov detalje er at Marianne faktisk hedder Douglas, da det er hendes konto han
-- bruger." A board member's own name, by Telegram account, used instead of the account's name.
CREATE TABLE board_people (
  telegram_id TEXT PRIMARY KEY,
  name TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO board_people (telegram_id, name)
  SELECT DISTINCT author_telegram_id, 'Douglas' FROM board_messages
  WHERE author_name = 'Marianne Lehmann Pedersen' AND author_telegram_id IS NOT NULL;

UPDATE board_messages SET author_name = (SELECT name FROM board_people WHERE telegram_id = board_messages.author_telegram_id)
  WHERE author_telegram_id IN (SELECT telegram_id FROM board_people);

-- Requested: "Vi skal også have indsat de sidste 10 referater ind i det nye system". Minutes taken
-- over from the board's own minutes document are a fourth source; the table is rebuilt as in 0011.
CREATE TABLE board_minutes_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('telegram', 'drive', 'upload', 'document')),
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
