-- Requested (Gitta): "Vælge/klikke på et event, have en lille dropdown menu om hvad man godt kunne tænke sig der blev lavet: story, reel, karrusel, andet?
-- Bare en hurtig måde for jer og mig at se hvad I gerne vil have delt/opmærksomhed på." One row per event and kind; who wished it, and when it was made.
CREATE TABLE event_pr_wishes (
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('story', 'reel', 'karrusel', 'andet')),
  wished_by TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  updated_at_ms INTEGER NOT NULL,
  done_by TEXT,
  done_at_ms INTEGER,
  PRIMARY KEY (event_id, kind)
);
