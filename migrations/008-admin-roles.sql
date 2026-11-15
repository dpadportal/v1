-- 008: role-based accounts (superadmin / division / district) + validation workflow

-- --- tickets: add validation columns and extend the status CHECK ---
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
  person_name TEXT,
  person_position TEXT,
  nature_of_request TEXT NOT NULL CHECK (nature_of_request IN ('complaint', 'suggestions', 'praise', 'inquiry', 'request')),
  description TEXT NOT NULL,
  privacy_consent INTEGER NOT NULL DEFAULT 0 CHECK (privacy_consent IN (0, 1)),
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Validated', 'Under Review', 'Resolved')),
  validated_by TEXT,
  validated_at TEXT,
  forwarded_to TEXT,
  forwarded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_file_name TEXT,
  evidence_file_url TEXT,
  evidence_mime TEXT,
  evidence_size INTEGER,
  evidence_thumbnail_url TEXT,
  intake_file_url TEXT
);

INSERT INTO tickets (id, arta_reference_no, full_name, cellphone_number, email_address, district, school_name, person_name, person_position, nature_of_request, description, privacy_consent, is_anonymous, status, created_at, updated_at, evidence_file_name, evidence_file_url, evidence_mime, evidence_size, evidence_thumbnail_url, intake_file_url)
SELECT id, arta_reference_no, full_name, cellphone_number, email_address, district, school_name, person_name, person_position, nature_of_request, description, privacy_consent, is_anonymous, status, created_at, updated_at, evidence_file_name, evidence_file_url, evidence_mime, evidence_size, evidence_thumbnail_url, intake_file_url
FROM tickets_old;

DROP TABLE tickets_old;

CREATE INDEX idx_tickets_email ON tickets (email_address);
CREATE INDEX idx_tickets_status ON tickets (status);
CREATE INDEX idx_tickets_created_at ON tickets (created_at);
CREATE INDEX idx_tickets_forwarded_to ON tickets (forwarded_to);

-- --- ticket_archive: track where the ticket was forwarded ---
ALTER TABLE ticket_archive ADD COLUMN forwarded_to TEXT;

-- --- admin_users: rebuild with the new role model ---
DROP INDEX IF EXISTS idx_admin_single_superadmin;

ALTER TABLE admin_users RENAME TO admin_users_old;

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'division' CHECK (role IN ('superadmin', 'division', 'district')),
  district_scope TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  recovery_question TEXT,
  recovery_answer_salt TEXT,
  recovery_answer_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO admin_users (id, username, password_salt, password_hash, role, district_scope, is_active, recovery_question, recovery_answer_salt, recovery_answer_hash, created_at)
SELECT id, username, password_salt, password_hash,
       CASE WHEN role = 'admin' THEN 'division' ELSE role END,
       NULL, 1, recovery_question, recovery_answer_salt, recovery_answer_hash, created_at
FROM admin_users_old;

DROP TABLE admin_users_old;

DELETE FROM admin_users WHERE username = 'admintest';

CREATE UNIQUE INDEX idx_admin_single_superadmin ON admin_users (role) WHERE role = 'superadmin';