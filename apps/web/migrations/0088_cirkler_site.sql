-- Requested: "Det lyder til hun har en gammel forståelse af cirkler. Det skal rettes. Og hun skal vide alt om cirkler fra cirklers
-- hjemmeside". cirkler.net's public pages as text, read every night in a real browser (the site is built in the browser) by the
-- workflow "Cirkler-viden" (.github/workflows/cirkler-site.yml). Saga answers about CIRKLER from this (worker/cockpit/cirkler.ts).
CREATE TABLE cirkler_site (
  path TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  fetched_at_ms INTEGER NOT NULL
) STRICT;
