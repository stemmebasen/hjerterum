-- Requested: "Saga skal ikke foreslå noget til et møde, før hun ved, om det er et teammøde." - and: Saga's suggestions for the next team meeting are there when you enter the page,
-- made once a day. `kind` is 'team' or 'andet' (a general assembly, an info meeting ...); NULL until someone has said which.
ALTER TABLE board_meetings ADD COLUMN kind TEXT CHECK (kind IN ('team', 'andet'));
