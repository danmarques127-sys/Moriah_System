-- Time clock: shifts with geolocation, field reports (note + photos) for the office, hourly rate per account.
ALTER TABLE client_accounts ADD COLUMN hourly_rate REAL NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS crew_punches(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,client_id INTEGER NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,in_at TEXT NOT NULL,out_at TEXT,in_lat REAL,in_lng REAL,out_lat REAL,out_lng REAL,job_id INTEGER);
CREATE INDEX IF NOT EXISTS crew_punches_client ON crew_punches(client_id,in_at);
CREATE TABLE IF NOT EXISTS field_reports(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,client_id INTEGER NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,note TEXT NOT NULL DEFAULT '',lat REAL,lng REAL,job_id INTEGER,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS field_report_photos(id INTEGER PRIMARY KEY AUTOINCREMENT,report_id INTEGER NOT NULL REFERENCES field_reports(id) ON DELETE CASCADE,mime TEXT NOT NULL,data BLOB NOT NULL);
PRAGMA user_version=15;
