-- Requested: "Sørg for at implementer Saga chat widget på alle tre sider ... Kan hun huske samtalen før og efter login".
-- The website (www.) and the member area (medlem.) are two addresses, so the browser cannot carry a conversation from one to the
-- other: it is kept here. A conversation from the website has no owner; it gets one when its visitor logs in through Saga's
-- button (the id rides in the link), and from then on only that member can read it. Kept 7 days without an owner, 30 with one
-- (web-saga.ts). Only the text is kept - never the photos.
CREATE TABLE saga_web_conversations (
  id TEXT PRIMARY KEY,
  clerk_user_id TEXT,
  messages TEXT NOT NULL DEFAULT '[]',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_saga_web_conversations_owner ON saga_web_conversations(clerk_user_id, updated_at_ms);
CREATE INDEX idx_saga_web_conversations_updated ON saga_web_conversations(updated_at_ms);

-- How many messages the website's visitors sent Saga a day: per visitor (a hash of the address, never the address) and in all.
CREATE TABLE saga_web_usage (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, day)
) STRICT;
