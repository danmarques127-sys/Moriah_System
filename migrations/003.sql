CREATE TABLE IF NOT EXISTS source_checks(source_id TEXT PRIMARY KEY,checked_at TEXT NOT NULL,ok INTEGER NOT NULL,http_status INTEGER NOT NULL DEFAULT 0,note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS error_log(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,area TEXT NOT NULL,source_id TEXT NOT NULL DEFAULT '',month TEXT NOT NULL DEFAULT '',message TEXT NOT NULL);
INSERT INTO error_log(created_at,area,source_id,month,message) SELECT updated_at,'collection',source_id,month,message FROM jobs WHERE status='failed';
PRAGMA user_version=3;
