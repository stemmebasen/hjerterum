-- MembershipWorks transition mirror.
-- This is a read-only import boundary: no code writes back to MembershipWorks.

CREATE TABLE membership_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source = 'membershipworks'),
  filename TEXT NOT NULL,
  imported_by_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  created_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  unchanged_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER
) STRICT;

CREATE INDEX idx_membership_import_batches_started
ON membership_import_batches(started_at_ms);

CREATE TABLE external_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source = 'membershipworks'),
  source_external_id TEXT,
  normalized_email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  membership_level TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  joined_at_text TEXT,
  expires_at_text TEXT,
  raw_json TEXT NOT NULL,
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  last_changed_at_ms INTEGER NOT NULL,
  last_import_batch_id INTEGER NOT NULL,
  FOREIGN KEY (last_import_batch_id) REFERENCES membership_import_batches(id) ON DELETE RESTRICT,
  UNIQUE (source, normalized_email)
) STRICT;

CREATE INDEX idx_external_memberships_status
ON external_memberships(source, status);

CREATE INDEX idx_external_memberships_external_id
ON external_memberships(source, source_external_id);

CREATE TABLE membership_import_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_batch_id INTEGER NOT NULL,
  external_membership_id INTEGER,
  normalized_email TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'rejected')),
  previous_json TEXT,
  current_json TEXT,
  reason TEXT,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (import_batch_id) REFERENCES membership_import_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (external_membership_id) REFERENCES external_memberships(id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_membership_import_changes_batch
ON membership_import_changes(import_batch_id);
