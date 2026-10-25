-- The collector's log is read per source (the status page, which sources are due); without this every lookup read the
-- whole log, and D1 bills every row read.
CREATE INDEX ingest_source_runs_source ON ingest_source_runs (source_id, started_at);
