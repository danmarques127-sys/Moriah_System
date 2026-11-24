-- Client profiles: personal details/photo per account, company details/logo per business.
ALTER TABLE client_accounts ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE client_accounts ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE client_accounts ADD COLUMN photo TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN website TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN logo TEXT NOT NULL DEFAULT '';
PRAGMA user_version=14;
