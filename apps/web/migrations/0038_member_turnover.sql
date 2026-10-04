-- Requested: "det er meningen at vi ved turnover importerer alle medlemmer og fra den dato begynder at trække kontingent over
-- vores nye system". On the day of the switch the MembershipWorks export becomes the platform's members
-- (worker/member-admin.ts importTurnover). Until the platform charges them itself, their payment still runs in
-- MembershipWorks (pays_in_membershipworks), and next_charge_on keeps the date the first charge here must fall on.
-- An imported member has no login yet: clerk_user_id is "pending:<email>" until they log in with that email.
ALTER TABLE members ADD COLUMN pays_in_membershipworks INTEGER NOT NULL DEFAULT 0 CHECK (pays_in_membershipworks IN (0, 1));
ALTER TABLE members ADD COLUMN next_charge_on TEXT;
