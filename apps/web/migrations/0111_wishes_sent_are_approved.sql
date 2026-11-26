-- The chair (26 Nov 2026): "We don't need that buffer. He has high authority, so whatever he says is something to work with."
-- Requests already sent and waiting count as approved by the one who sent them (cockpit/wishes.ts sendWish).
UPDATE wishes SET status = 'approved', decided_by = author, decided_at_ms = COALESCE(sent_at_ms, updated_at_ms) WHERE status = 'sent';
