-- The chair (27 Nov 2026): "Det er vigtigt at Jewel briefer Douglas og giver en eta på hvornår hans ændringer cirka er live" - when a request is sent,
-- the time it is expected live (cockpit/wishes.ts liveEta).
ALTER TABLE wishes ADD COLUMN eta_ms INTEGER;
