-- Client channel (off by default): separate login and sessions, no access to internal routes.
ALTER TABLE client_accounts ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS client_sessions(token_hash TEXT PRIMARY KEY,client_id INTEGER NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
PRAGMA user_version=7;
