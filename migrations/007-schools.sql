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