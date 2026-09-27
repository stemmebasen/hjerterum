-- Requested: "Hjerterum, hvad vil være en smart gengivelse af telegram gruppechatten?" - "Ja!" -
-- "Men vi skal også have lavet en lignende analyse af dokumentet - f.eks. beslutninger, foreslag,
-- opgaver. Måske skal vi samle ét sted med spørgsmål og todos til mig drager ud af både telegram og
-- doc og mail". The same overview call now also returns its picture as structured data (the group's
-- topics, the document's decisions, proposals and tasks, and what waits on the chair), and the
-- chair can mark an item as done so it is not raised again.

ALTER TABLE board_overviews ADD COLUMN data TEXT;
ALTER TABLE board_overviews ADD COLUMN doc_hash TEXT;

CREATE TABLE board_owner_done (
  item_key TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  done_at_ms INTEGER NOT NULL
) STRICT;
