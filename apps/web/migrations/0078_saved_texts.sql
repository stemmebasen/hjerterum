-- Asked: "Hvorfor kan hun ikke hjælpe?" after "Vil du gemme formandens tale fra Generalforsamlingen:" got "det kan jeg desværre ikke gemme". Texts a board
-- member asks Saga to keep - a speech, a note, a draft - with who kept it, and the Google Doc made of it when Drive is connected.
CREATE TABLE saved_texts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  saved_by TEXT,
  doc_url TEXT,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_saved_texts_created ON saved_texts(created_at_ms);
