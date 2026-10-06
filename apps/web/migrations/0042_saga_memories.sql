-- Requested by the chair: "Og vigtigt at Saga lærer af vores samtaler!" What a member tells Saga, or corrects her on, that is worth keeping:
-- 'member' memories are about one member (preferences, how they like answers) and used only for them; 'board' memories are about the house and
-- used for everyone. Each says who taught her. Members see and can delete their own, the chair can delete any (cockpit/memory.ts).
CREATE TABLE saga_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK (scope IN ('member', 'board')),
  member TEXT,
  text TEXT NOT NULL,
  learned_from TEXT,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_saga_memories_scope ON saga_memories(scope, member, created_at_ms);
