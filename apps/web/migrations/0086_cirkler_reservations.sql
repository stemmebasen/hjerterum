-- Besluttet (Jake, 31. oktober 2026): cirkelmøder i Hjerterums sal bookes gennem CIRKLER med samme kalender og
-- samme regler som medlemmernes events. CIRKLER kalder PUT /api/integrations/cirkler/reservations/<mødets id>
-- (cirkler-integration.ts). Mødets id er nøglen, så et nyt forsøg opdaterer den samme reservation og aldrig
-- laver en dublet. Hjerterum gemmer intet om deltagerne: reservationen ejes af den faste konto "cirkler",
-- hedder "CIRKLER-møde" og koster ingen leje (salen er stillet til rådighed).
ALTER TABLE room_bookings ADD COLUMN cirkler_meeting_id TEXT;
CREATE UNIQUE INDEX idx_room_bookings_cirkler_meeting ON room_bookings(cirkler_meeting_id) WHERE cirkler_meeting_id IS NOT NULL;
