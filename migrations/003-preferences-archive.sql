CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE ticket_archive ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ticket_archive ADD COLUMN evidence_thumbnail_url TEXT;
ALTER TABLE ticket_archive ADD COLUMN intake_file_url TEXT;