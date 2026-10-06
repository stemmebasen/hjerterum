-- Saga's questions and tasks now go to the board member they concern (not only to the chair). What a member ticks off is
-- kept per member, so an item for everyone stays open for the others. Saga is told what each has done, so she does not bring it back.
CREATE TABLE cockpit_saga_done (
  member TEXT NOT NULL,
  item_key TEXT NOT NULL,
  text TEXT NOT NULL,
  done_at_ms INTEGER NOT NULL,
  PRIMARY KEY (member, item_key)
) STRICT;

CREATE INDEX idx_cockpit_saga_done_at ON cockpit_saga_done(done_at_ms);
