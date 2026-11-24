-- Per-company limits: how many cities a company may have and how many distinct permits it may open per calendar month.
ALTER TABLE companies ADD COLUMN max_cities INTEGER NOT NULL DEFAULT 3;
ALTER TABLE companies ADD COLUMN monthly_permits INTEGER NOT NULL DEFAULT 1000;
-- Each permit counts once per company per month, however many times it is viewed.
CREATE TABLE IF NOT EXISTS permit_seen(company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,month TEXT NOT NULL,permit_key TEXT NOT NULL,PRIMARY KEY(company_id,month,permit_key));
PRAGMA user_version=10;
