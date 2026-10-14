-- Asked: "Kan hun ikke huske beskedhistorik i chatten?" - Saga answered a bare "Ja" as if nothing had been said before it.
-- Each question in the admin's chat keeps which conversation it belongs to, so the server knows the conversation itself
-- and does not depend on the browser having kept it.
ALTER TABLE cockpit_questions ADD COLUMN conversation TEXT;

CREATE INDEX idx_cockpit_questions_conversation ON cockpit_questions(asked_by, conversation, created_at_ms);
