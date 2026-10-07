-- Requested: "Der anbefales op til fire suppleanter på generalforsamlingen" stod som en beslutning med laurbær - en anbefaling er ikke en beslutning.
-- Saga's first sorting was too generous (86 of 100 points were left as decisions). What she called a decision is sorted again with the sharper instruction (cockpit/decisionKinds.ts);
-- what she called an agreement stays, and so does everything a board member moved.
DELETE FROM cockpit_decision_kinds WHERE decided_by = 'Saga' AND kind = 'beslutning';
