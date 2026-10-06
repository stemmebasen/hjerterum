-- Requested by the chair: "Indbyg at man skal skrive hvad ens ansvarsområder er, så Saga ved besked".
-- What each board member says they are responsible for, in their own words. Saga reads it to know who a matter concerns.
CREATE TABLE cockpit_responsibilities (
  member TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;
