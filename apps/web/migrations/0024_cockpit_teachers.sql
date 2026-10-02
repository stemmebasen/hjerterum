-- Requested: "Vi skal også have en underside til arrangementer, som hedder Undervisere, hvor vi samler alle
-- underviserne. Man kan så klikke ind på hver underviser, udfylde basis-kontaktinformationer, hvis systemet ikke
-- allerede har dem, samt bede Saga om at lave et resumé af vores samarbejde med denne underviser." - "Men ser
-- ikke, at man som udgangspunkt selv skal hente de undervisere, der allerede eksisterer."
-- The teachers themselves are collected from the calendar and the bookings; this keeps only what the board adds:
-- contact details and Saga's summary (the platform's own `teachers` register is a different table), keyed by the teacher's name in lower case.
CREATE TABLE cockpit_teachers (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  website TEXT,
  note TEXT,
  summary TEXT,
  summary_at_ms INTEGER,
  summary_by TEXT,
  updated_by TEXT,
  updated_at_ms INTEGER NOT NULL
) STRICT;
