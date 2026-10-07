-- Requested: "I forhold til oplæg til dagsorden skal vi bare have det i punktform, så man kan oprette et punkt. Der skal altså ikke være fri tekst. Jeg forestiller mig, at Sagas forslag
-- allerede er præsenteret i punktform i bunden, og at man let skal kunne slette hver med et kryds."
-- The agenda is a list of points (one per line in `agenda`); `agenda_saga` holds the ones Saga suggested (the same lines), so that they carry a small mark until they are deleted.
ALTER TABLE board_meetings ADD COLUMN agenda_saga TEXT NOT NULL DEFAULT '';
