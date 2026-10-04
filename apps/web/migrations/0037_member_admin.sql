-- Requested: "Hvad med "Medlemmer"-sektion i admin, hvor vi kan se medlemmer, profilinfo, status og historik?" -
-- "Husk den skal lægge sig op ad hvad MembershipWorks gør med medlemmer" - "vi skal kun fokusere på vores eget systems
-- medlemmer". The platform's own members (members): how each is billed (card through Stripe, or given by Hjerterum as
-- MembershipWorks' "Manual Billing"), since when the current status has held ("Past Due 35 Days"), since when the person
-- has been a member, and a timeline written by Stripe's webhooks and the board's actions (worker/member-admin.ts).
ALTER TABLE members ADD COLUMN billing TEXT NOT NULL DEFAULT 'stripe' CHECK (billing IN ('stripe', 'manual'));
ALTER TABLE members ADD COLUMN status_since_ms INTEGER;
ALTER TABLE members ADD COLUMN joined_on TEXT;
ALTER TABLE members ADD COLUMN membershipworks_id TEXT;

CREATE TABLE member_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  at_ms INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('joined', 'granted', 'moved', 'payment', 'payment_failed', 'status', 'plan', 'cancelled', 'ended', 'reactivated', 'note')),
  title TEXT NOT NULL,
  amount_minor INTEGER,
  detail TEXT,
  by_name TEXT,
  source_event_id TEXT UNIQUE,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_member_timeline_member ON member_timeline(member_id, at_ms);

-- "Jeg kan faktisk godt eksportere" - "Det er godt at have dette liggende, når og hvis medlemmet vælger at oprette sig i
-- vores nye system. Indtil da fortsætter de blot i MW". MembershipWorks' account export, kept for reference only: it gives
-- no one access and changes nothing in MembershipWorks. When a person becomes a member here, their account is linked
-- (member since, phone, teacher) and the board is reminded to stop the payment in MembershipWorks.
CREATE TABLE membershipworks_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  accounts INTEGER NOT NULL,
  uploaded_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE membershipworks_accounts (
  email TEXT PRIMARY KEY,
  account_id TEXT,
  full_name TEXT NOT NULL,
  phone TEXT,
  plan TEXT,
  tier TEXT,
  interval TEXT CHECK (interval IN ('month', 'year')),
  billing TEXT CHECK (billing IN ('auto', 'manual')),
  joined_on TEXT,
  renews_on TEXT,
  stripe_customer_id TEXT,
  labels TEXT NOT NULL DEFAULT '[]',
  row_json TEXT NOT NULL,
  upload_id INTEGER NOT NULL,
  FOREIGN KEY (upload_id) REFERENCES membershipworks_uploads(id)
) STRICT;
