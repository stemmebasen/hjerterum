-- Requested: "Vi skal have en Saga chatwidget på medlemssiden" - how many messages each member sent Saga a day, so it stays cheap.
CREATE TABLE member_saga_usage (
  clerk_user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (clerk_user_id, day)
) STRICT;
