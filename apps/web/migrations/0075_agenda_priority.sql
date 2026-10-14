-- Requested: "Hun skal selv prioritere hvad der virker til at haste mest på dagsordenen og hvad der kan vente til senere. Start altid med et
-- Velkommen punkt, samt slut med Evt." When Saga last put a team meeting's agenda in order, and when a member last moved its points by hand -
-- she does not sort over a member's own order.
ALTER TABLE board_meetings ADD COLUMN agenda_sorted_at_ms INTEGER;
ALTER TABLE board_meetings ADD COLUMN agenda_moved_at_ms INTEGER;
