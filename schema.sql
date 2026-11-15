DROP TABLE IF EXISTS tickets;

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

CREATE INDEX idx_tickets_email ON tickets (email_address);
CREATE INDEX idx_tickets_status ON tickets (status);
CREATE INDEX idx_tickets_created_at ON tickets (created_at);
CREATE INDEX idx_tickets_forwarded_to ON tickets (forwarded_to);

CREATE TABLE IF NOT EXISTS admin_users (
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_single_superadmin ON admin_users (role) WHERE role = 'superadmin';

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_log (created_at);

CREATE TABLE IF NOT EXISTS ticket_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arta_reference_no TEXT NOT NULL UNIQUE,
  full_name TEXT,
  cellphone_number TEXT,
  email_address TEXT NOT NULL,
  district TEXT,
  school_name TEXT NOT NULL,
  person_name TEXT,
  person_position TEXT,
  nature_of_request TEXT NOT NULL,
  description TEXT NOT NULL,
  privacy_consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Resolved',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  forwarded_to TEXT,
  evidence_file_name TEXT,
  evidence_file_url TEXT,
  evidence_mime TEXT,
  evidence_size INTEGER,
  evidence_thumbnail_url TEXT,
  intake_file_url TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_archive_created_at ON ticket_archive (created_at);

CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  district TEXT NOT NULL,
  school_name TEXT NOT NULL,
  school_id TEXT,
  school_email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (district, school_name)
);

CREATE INDEX IF NOT EXISTS idx_schools_district ON schools (district);
