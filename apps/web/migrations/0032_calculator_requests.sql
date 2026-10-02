-- Requested: the price calculator's booking request lands as an e-mail in team@ (beregner/handler.ts). Only the time
-- and a hash of the sender's address are kept, to stop a flood: a few requests an hour from one address.
CREATE TABLE calculator_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_calculator_requests_ip ON calculator_requests(ip_hash, at_ms);
