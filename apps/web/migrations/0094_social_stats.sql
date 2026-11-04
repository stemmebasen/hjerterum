-- Requested (the chair, 3 Nov 2026: "Ja til det hele" to the plan's "månedlig indsigt"): one count a day of Hjerterum's followers on Facebook and
-- Instagram, so PR og SoMe can show the month's growth next to what was sent (worker/cockpit/prInsight.ts). Additive.
CREATE TABLE social_stats (
  day TEXT PRIMARY KEY,
  fb_followers INTEGER,
  ig_followers INTEGER,
  ig_media INTEGER,
  at_ms INTEGER NOT NULL
) STRICT;
