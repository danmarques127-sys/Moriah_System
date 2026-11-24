-- Business accounts: roles inside an affiliated company, favorites and site visits (measurements, notes, photos).
ALTER TABLE client_accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','seller','employee'));
CREATE TABLE IF NOT EXISTS client_favorites(client_id INTEGER NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,permit_key TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(client_id,permit_key));
CREATE TABLE IF NOT EXISTS site_visits(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,client_id INTEGER NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,permit_key TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',measurements TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS site_photos(id INTEGER PRIMARY KEY AUTOINCREMENT,visit_id INTEGER NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,mime TEXT NOT NULL,data BLOB NOT NULL);
PRAGMA user_version=11;
