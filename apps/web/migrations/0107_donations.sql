-- Douglas (13 Nov 2026), for the board: "Are we having a donation page or somewhere where people can donate on the website? Plus an email that gets
-- sent as a receipt for their donation." A donation by card through Stripe, with its receipt.
CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  message TEXT,
  paid_at_ms INTEGER NOT NULL,
  receipt_sent_at_ms INTEGER
);
