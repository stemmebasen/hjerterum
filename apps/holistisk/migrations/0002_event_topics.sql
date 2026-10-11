-- Narrower topics (src/activities.ts: klarsyn, soundbath, MBSR …), found at collection time like the categories,
-- so a topic's page lists events that are about it rather than events that mention its word once.
CREATE TABLE event_topics (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  PRIMARY KEY (event_id, topic)
) STRICT;

CREATE INDEX event_topics_topic ON event_topics (topic, event_id);
