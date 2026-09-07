-- Legacy parity additions discovered from the validated Replit snapshot.
-- This migration preserves source data needed for a lossless import without
-- reintroducing the retired Tribes product into the active user experience.

ALTER TABLE teachers ADD COLUMN setup_intent_id TEXT;

ALTER TABLE bookings ADD COLUMN phone TEXT;
ALTER TABLE bookings ADD COLUMN cvr TEXT;

CREATE INDEX idx_teachers_setup_intent_id ON teachers(setup_intent_id);

-- Historical Tribes archive. These tables contain sensitive personal data and
-- must only be reachable through explicitly admin-gated archive/recovery flows.
CREATE TABLE tribes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  created_at_ms INTEGER,
  updated_at_ms INTEGER
) STRICT;

CREATE TABLE tribe_members (
  id INTEGER PRIMARY KEY,
  tribe_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  birthdate TEXT,
  email TEXT,
  address TEXT,
  created_at_ms INTEGER,
  updated_at_ms INTEGER,
  FOREIGN KEY (tribe_id) REFERENCES tribes(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_tribe_members_tribe_id ON tribe_members(tribe_id);
CREATE INDEX idx_tribe_members_email ON tribe_members(email);

CREATE TABLE tribe_applicants (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  status TEXT,
  birthdate TEXT,
  gender TEXT,
  email TEXT,
  address TEXT,
  motivation TEXT,
  hopes TEXT,
  themes TEXT,
  group_style TEXT,
  depth TEXT,
  safety_needs TEXT,
  hidden_trait TEXT,
  preferred_meeting_time TEXT,
  is_member TEXT,
  member_number TEXT,
  invitation_token TEXT,
  invitation_sent_at_ms INTEGER,
  invitation_accepted_at_ms INTEGER,
  invitation_reminder_sent_at_ms INTEGER,
  invitation_second_reminder_sent_at_ms INTEGER,
  personal_welcome_email_sent_at_ms INTEGER,
  stale_reminder_sent_at_ms INTEGER,
  tribe_id INTEGER,
  created_at_ms INTEGER,
  updated_at_ms INTEGER,
  FOREIGN KEY (tribe_id) REFERENCES tribes(id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_tribe_applicants_tribe_id ON tribe_applicants(tribe_id);
CREATE INDEX idx_tribe_applicants_email ON tribe_applicants(email);
CREATE INDEX idx_tribe_applicants_status ON tribe_applicants(status);
CREATE INDEX idx_tribe_applicants_invitation_token ON tribe_applicants(invitation_token);

CREATE TABLE tribe_email_logs (
  id INTEGER PRIMARY KEY,
  tribe_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  recipient_count INTEGER,
  sender_email TEXT,
  sent_at_ms INTEGER,
  FOREIGN KEY (tribe_id) REFERENCES tribes(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_tribe_email_logs_tribe_id ON tribe_email_logs(tribe_id);
CREATE INDEX idx_tribe_email_logs_sent_at_ms ON tribe_email_logs(sent_at_ms);
