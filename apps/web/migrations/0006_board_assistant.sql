-- Hjerterum board assistant: the board's Telegram chat log, posts waiting for the chair's
-- approval, and meeting minutes drafted from recordings.
-- Nothing is posted to the board chat without an explicit approval (see docs/decisions/0005).

CREATE TABLE board_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  author_telegram_id TEXT,
  text TEXT NOT NULL,
  sent_at_ms INTEGER NOT NULL,
  from_assistant INTEGER NOT NULL DEFAULT 0 CHECK (from_assistant IN (0, 1)),
  UNIQUE (chat_id, telegram_message_id)
) STRICT;

CREATE INDEX idx_board_messages_sent ON board_messages(chat_id, sent_at_ms);

-- A post the assistant wants to make in the board chat. It is only sent once approved.
CREATE TABLE board_post_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('reply', 'weekly_summary', 'minutes', 'announcement')),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'posted', 'failed')),
  reply_to_message_id INTEGER,
  minutes_id INTEGER,
  approval_message_id INTEGER,
  posted_message_id INTEGER,
  created_at_ms INTEGER NOT NULL,
  decided_at_ms INTEGER,
  last_error TEXT
) STRICT;

CREATE INDEX idx_board_post_drafts_status ON board_post_drafts(status);

-- Minutes from one meeting recording: queued -> transcribing -> drafted -> approved/rejected.
CREATE TABLE board_minutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('telegram', 'drive')),
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

CREATE INDEX idx_board_minutes_status ON board_minutes(status, created_at_ms);
