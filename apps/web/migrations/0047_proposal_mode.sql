-- Requested: "Når man stiller et forslag skal man kunne vælge om man ønsker digital afstemning eller afstemning på næste møde.
-- Hvis næste møde forslår Saga det som punkt på næste dagsorden."
-- 'digital': the board votes on the page (cockpit/votes.ts). 'moede': the vote is taken at the next meeting - no votes here, no auto-settling;
-- Saga puts the proposal on the agenda, and a board member records the outcome afterwards.
ALTER TABLE board_proposals ADD COLUMN mode TEXT NOT NULL DEFAULT 'digital' CHECK (mode IN ('digital', 'moede'));
