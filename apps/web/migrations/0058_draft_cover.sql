-- Requested: a Facebook cover (1920 × 1005 px) on Saga's event draft, which follows the event when it is created.
ALTER TABLE cockpit_event_drafts ADD COLUMN cover_key TEXT;
ALTER TABLE cockpit_event_drafts ADD COLUMN cover_name TEXT;
ALTER TABLE cockpit_event_drafts ADD COLUMN cover_type TEXT;
