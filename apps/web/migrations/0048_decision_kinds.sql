-- Requested: "Vi skal også differentiere mellem beslutninger og uformelle aftaler, som for eksempel: De tre ansatte (Lisbeth, Gitta, Frederik) holder møde om opgavefordeling".
-- A point from the minutes is a decision of the board ('beslutning') or an informal agreement between a few people ('aftale'). Saga sorts the ones she has not seen (cockpit/decisionKinds.ts),
-- a board member can move any of them; what is in this table wins over where the point stands in the minutes. Nothing here changes the minutes themselves.
CREATE TABLE cockpit_decision_kinds (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('beslutning', 'aftale')),
  decided_by TEXT NOT NULL,
  at_ms INTEGER NOT NULL
) STRICT;
