-- Saga watches Hjerterum's main mailbox (team@holistisk.org) for the chair: each new mail once,
-- with her verdict, and whether the chair was told. Mail is read in Matrix and relayed here; it
-- is never shown in Posthus or Samtaler.

CREATE TABLE board_mail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_ref TEXT NOT NULL UNIQUE,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  preview TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT 'pending' CHECK (verdict IN ('pending', 'attention', 'fyi', 'ignore')),
  reason TEXT,
  notified INTEGER NOT NULL DEFAULT 0 CHECK (notified IN (0, 1)),
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_board_mail_received ON board_mail(received_at_ms);
