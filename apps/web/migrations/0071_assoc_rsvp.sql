-- Requested: "Kan du indsætte en lille knap? 'Jeg kommer' til vores fælles møder, inklusive generalforsamling." Who has said they are coming to
-- one of the association's gatherings in the golden card (cockpit/assocEvents.ts): 'moede:<id>' for a meeting in Møder, 'hus:<id>' for one in
-- the house's calendar.
CREATE TABLE assoc_rsvp (
  event_key TEXT NOT NULL,
  member TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  PRIMARY KEY (event_key, member)
) STRICT;
