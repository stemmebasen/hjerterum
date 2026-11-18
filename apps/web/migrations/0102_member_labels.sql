-- Douglas (13 Nov 2026), for the board: "How can we assign a label to a member?" - labels the board gives, kept by e-mail so they hold for a member
-- in MembershipWorks now and the same person here after the switch. Shown beside the labels from MembershipWorks' export.
CREATE TABLE IF NOT EXISTS member_labels (
  email TEXT NOT NULL,
  label TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at_ms INTEGER NOT NULL,
  PRIMARY KEY (email, label)
);
