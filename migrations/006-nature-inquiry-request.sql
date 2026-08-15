DROP INDEX IF EXISTS idx_tickets_email;
DROP INDEX IF EXISTS idx_tickets_status;
DROP INDEX IF EXISTS idx_tickets_created_at;

ALTER TABLE tickets RENAME TO tickets_old;

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arta_reference_no TEXT NOT NULL UNIQUE,
  full_name TEXT,
  cellphone_number TEXT,
  email_address TEXT NOT NULL,
  district TEXT,
  school_name TEXT NOT NULL,
  nature_of_request TEXT NOT NULL CHECK (nature_of_request IN ('complaint', 'suggestions', 'praise', 'inquiry', 'request')),
  description TEXT NOT NULL,
  privacy_consent INTEGER NOT NULL DEFAULT 0 CHECK (privacy_consent IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Under Review', 'Resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_file_name TEXT,
  evidence_file_url TEXT,
  evidence_mime TEXT,
  evidence_size INTEGER,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  evidence_thumbnail_url TEXT,
  intake_file_url TEXT,
  person_name TEXT,
  person_position TEXT
);

INSERT INTO tickets (id, arta_reference_no, full_name, cellphone_number, email_address, district, school_name, nature_of_request, description, privacy_consent, status, created_at, updated_at, evidence_file_name, evidence_file_url, evidence_mime, evidence_size, is_anonymous, evidence_thumbnail_url, intake_file_url, person_name, person_position)
SELECT id, arta_reference_no, full_name, cellphone_number, email_address, district, school_name, nature_of_request, description, privacy_consent, status, created_at, updated_at, evidence_file_name, evidence_file_url, evidence_mime, evidence_size, is_anonymous, evidence_thumbnail_url, intake_file_url, person_name, person_position
FROM tickets_old;

DROP TABLE tickets_old;

CREATE INDEX idx_tickets_email ON tickets (email_address);
CREATE INDEX idx_tickets_status ON tickets (status);
CREATE INDEX idx_tickets_created_at ON tickets (created_at);