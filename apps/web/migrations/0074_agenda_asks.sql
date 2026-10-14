-- Requested: "24 hours before a team meeting she should write to each and every board member directly and ask if they have anything
-- to add to the agenda ... they can just write it to her in the chat and she will add it". What she wrote to whom, so an answer in
-- the private chat is read as an answer to it.
CREATE TABLE agenda_asks (
  telegram_id TEXT NOT NULL,
  member TEXT NOT NULL,
  meeting_id INTEGER NOT NULL,
  meeting_start_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  sent_at_ms INTEGER NOT NULL,
  PRIMARY KEY (telegram_id, meeting_id)
) STRICT;
