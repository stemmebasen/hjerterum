-- Requested (Gitta): teachers without contact details that are only noise can be removed from the list. Hidden, not erased - the calendar keeps its history.
CREATE TABLE cockpit_teachers_hidden (
  key TEXT PRIMARY KEY,
  hidden_by TEXT NOT NULL,
  hidden_at_ms INTEGER NOT NULL
) STRICT;
