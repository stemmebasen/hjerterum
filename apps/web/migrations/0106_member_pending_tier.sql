-- Douglas (13 Nov 2026), for the board: a member who changes level gets only the paid levels, and "it is simplest if the change happens at the
-- next renewal date". The level that takes over at the next renewal (set from the member area; taken over when Stripe renews).
ALTER TABLE members ADD COLUMN pending_tier TEXT;
