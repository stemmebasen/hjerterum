-- Requested: "Hjerterum skal dog have flere henvendelsesformularer ligesom på stemmebasen.dk". Each enquiry from the
-- website's forms goes to team@'s inbox (worker/enquiries.ts); here only the day, topic and page are kept, for the
-- statistics (enquiries and conversion). Nothing about the sender. Deleted after six months with the visits.
CREATE TABLE site_enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  topic TEXT NOT NULL,
  path TEXT NOT NULL
) STRICT;

CREATE INDEX idx_site_enquiries_day ON site_enquiries(day);
