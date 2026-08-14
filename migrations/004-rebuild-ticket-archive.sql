DROP TABLE IF EXISTS ticket_archive;

CREATE TABLE ticket_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arta_reference_no TEXT NOT NULL UNIQUE,
  full_name TEXT,
  cellphone_number TEXT,
  email_address TEXT NOT NULL,
  district TEXT,
  school_name TEXT NOT NULL,
  nature_of_request TEXT NOT NULL,
  description TEXT NOT NULL,
  privacy_consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Resolved',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_file_name TEXT,
  evidence_file_url TEXT,
  evidence_mime TEXT,
  evidence_size INTEGER,
  evidence_thumbnail_url TEXT,
  intake_file_url TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_archive_created_at ON ticket_archive (created_at);