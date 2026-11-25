-- The chair (25 Nov 2026): the development agent gets a name of her own - Jewel - and is more specialised (cockpit/wishes.ts): each request says
-- what kind it is (fejl, forbedring, ny funktion), Jewel's guess at its size (lille, mellem, stor) and when it is done ("Det er færdigt, når ...").
ALTER TABLE wishes ADD COLUMN kind TEXT;
ALTER TABLE wishes ADD COLUMN size TEXT;
ALTER TABLE wishes ADD COLUMN done_when TEXT;
