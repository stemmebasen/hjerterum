-- The way from a visit to a member (src/stats.ts, Jake 2026-11-19): how many people reach each step a day. Counted
-- like visitors, without cookies: a person is a hash of the day's salt, IP address and browser, deleted the next night,
-- leaving only the number per day and step.
CREATE TABLE funnel_people (
  day TEXT NOT NULL,
  step TEXT NOT NULL CHECK (length(step) <= 40),
  visitor TEXT NOT NULL,
  PRIMARY KEY (day, step, visitor)
) STRICT;

CREATE TABLE funnel_days (
  day TEXT NOT NULL,
  step TEXT NOT NULL CHECK (length(step) <= 40),
  people INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, step)
) STRICT;
