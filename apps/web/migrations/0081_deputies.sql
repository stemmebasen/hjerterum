-- Requested: "Hvordan kan vi lave login til vores frivillige og suppleanter. De skal ikke have adgang til bestyrelsens interne
-- diskussioner men må gerne se mere generelle ting." - "Lad os starte med suppleant adgang".
-- A deputy is someone in the deputies' Telegram group (SAGA_DEPUTY_CHAT_ID). Saga only notes who they are there - never what is written.
CREATE TABLE cockpit_deputies (
  telegram_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  seen_at_ms INTEGER NOT NULL
) STRICT;

-- A login link is for the board (NULL, as every link before this) or for a deputy ('suppleant').
ALTER TABLE cockpit_login_links ADD COLUMN role TEXT CHECK (role IS NULL OR role = 'suppleant');

-- Minutes are internal to the board until a board member shares them with the deputies.
ALTER TABLE board_minutes ADD COLUMN deputies_at_ms INTEGER;
ALTER TABLE board_minutes ADD COLUMN deputies_by TEXT;
