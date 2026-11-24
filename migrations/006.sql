-- Partner (affiliated company) data model: trades, companies, client accounts, usage, plus audit actor.
CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1);
INSERT OR IGNORE INTO trades(name) VALUES('Painting'),('Insulation'),('Flooring'),('Framing'),('Sheetrock'),('Roofing'),('Electrical'),('Plumbing'),('HVAC'),('Other');
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,contact_name TEXT NOT NULL DEFAULT '',contact_email TEXT NOT NULL DEFAULT '',contact_phone TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,joined_on TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS company_trades(company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,PRIMARY KEY(company_id,trade_id));
CREATE TABLE IF NOT EXISTS client_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS client_cities(client_id INTEGER NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,source_id TEXT NOT NULL,PRIMARY KEY(client_id,source_id));
CREATE TABLE IF NOT EXISTS usage_events(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('seen','exported')),permits INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
-- Future client area (not built yet): permits a client marked to work on.
CREATE TABLE IF NOT EXISTS permit_marks(client_id INTEGER NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,permit_key TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'interested',notes TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(client_id,permit_key));
ALTER TABLE audit ADD COLUMN actor TEXT NOT NULL DEFAULT '';
ALTER TABLE audit ADD COLUMN kind TEXT NOT NULL DEFAULT 'system';
PRAGMA user_version=6;
