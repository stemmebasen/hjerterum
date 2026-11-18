-- Douglas (13 Nov 2026), for the board: "When a new member signs up, is there somewhere on the form where they click to accept the conditions or
-- terms?" - when the member accepted the terms (vilkår for medlemskab and handelsbetingelserne) as they joined here.
ALTER TABLE members ADD COLUMN terms_accepted_at_ms INTEGER;
