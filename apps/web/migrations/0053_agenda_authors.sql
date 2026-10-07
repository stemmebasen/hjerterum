-- Requested: "Lige nu står der Sagas forslag ved nogle punkter, men kan vi skrive et bestyrelsesmedlems navn, hvis det er ham, der har oprettet punktet, og bruge samme farvekode som under opgaver?"
-- Who made each point of an agenda: a JSON object {"point": "name"} (Saga's points are in agenda_saga, not here).
ALTER TABLE board_meetings ADD COLUMN agenda_authors TEXT NOT NULL DEFAULT '{}';
