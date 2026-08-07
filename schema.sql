DROP TABLE IF EXISTS tickets;

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arta_reference_no TEXT NOT NULL UNIQUE,
  full_name TEXT,
  cellphone_number TEXT,
  email_address TEXT NOT NULL,
  district TEXT,
  school_name TEXT NOT NULL,
  nature_of_request TEXT NOT NULL CHECK (nature_of_request IN ('complaint', 'suggestions', 'praise')),
  description TEXT NOT NULL,
  privacy_consent INTEGER NOT NULL DEFAULT 0 CHECK (privacy_consent IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Under Review', 'Resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tickets_email ON tickets (email_address);
CREATE INDEX idx_tickets_status ON tickets (status);
CREATE INDEX idx_tickets_created_at ON tickets (created_at);
