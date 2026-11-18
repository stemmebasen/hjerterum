-- Douglas (13 Nov 2026), for the board: "There must be an ability to make a free trial period available in the membership levels".
-- Days free for one who joins for the first time; NULL keeps the level's default (membership.ts).
ALTER TABLE membership_levels ADD COLUMN trial_days INTEGER CHECK (trial_days IS NULL OR (trial_days >= 0 AND trial_days <= 365));
