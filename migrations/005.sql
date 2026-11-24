CREATE TABLE IF NOT EXISTS manual_imports(id INTEGER PRIMARY KEY AUTOINCREMENT,source_id TEXT NOT NULL,month TEXT NOT NULL,imported_at TEXT NOT NULL,added INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL DEFAULT 0,by_email TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS manual_imports_source ON manual_imports(source_id,imported_at);
PRAGMA user_version=5;
