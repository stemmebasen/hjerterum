-- Requested: "We spend around $3 to $4 each day on AI calls ... Come with a suggestion on how we can save money" - "Ja, det må du gerne".
-- One row per AI call: what it was for, which model, how many tokens went in and out, and whether the cheap model had to be replaced by the main one.
CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  fallback INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX idx_ai_usage_at ON ai_usage(at_ms);
