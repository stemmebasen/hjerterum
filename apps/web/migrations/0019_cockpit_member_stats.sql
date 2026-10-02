-- Requested: "Hvis vi uploader et sådan skærmbillede til Saga ind i mellem, kan hun så opdatere det i
-- systemet?" - "I can't see that you have inserted the figures anywhere." The member figures from
-- MembershipWorks' dashboard, one dated row per update: totals only, never a member's name.
CREATE TABLE cockpit_member_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_on TEXT NOT NULL,
  total_accounts INTEGER NOT NULL,
  with_membership INTEGER,
  paying INTEGER NOT NULL,
  free INTEGER,
  past_due INTEGER,
  pending_cancellation INTEGER,
  cancelled INTEGER,
  annual_revenue_kr INTEGER,
  plans TEXT NOT NULL DEFAULT '[]',
  added_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_cockpit_member_stats_day ON cockpit_member_stats(taken_on, id);

-- The figures from Jacob's screenshot of MembershipWorks (Current Stats), 2 October 2026.
INSERT INTO cockpit_member_stats (taken_on, total_accounts, with_membership, paying, free, past_due, pending_cancellation, cancelled, annual_revenue_kr, plans, added_by, created_at_ms)
VALUES ('2026-10-02', 440, 378, 169, 187, 16, 0, 5, 345144,
  '[{"name":"Betaling stoppet","count":177,"share":46.8},{"name":"Standard (222 kr./md. eller 2.310 kr./år)","count":106,"share":28},{"name":"Reduceret pris (111 kr./md. eller 1.155 kr./år)","count":52,"share":13.8},{"name":"Støtte (50 kr./md. eller 540 kr./år)","count":null,"share":4},{"name":"Gratis medlemskab","count":null,"share":2.6},{"name":"Reduced price, engelsk (111 kr./md.)","count":null,"share":1.1},{"name":"Generøst (333 kr./md. eller 3.465 kr./år)","count":null,"share":0.3}]',
  'Jacob', 1790935200000);
