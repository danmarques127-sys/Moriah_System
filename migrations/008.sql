-- Personal profile for each internal user (name, phone, title, small photo as a data URL) and removal of the Barnstable source.
CREATE TABLE IF NOT EXISTS user_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,display_name TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',title TEXT NOT NULL DEFAULT '',photo TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '');
DELETE FROM permits WHERE source_id='barnstable';
DELETE FROM coverage WHERE source_id='barnstable';
DELETE FROM jobs WHERE source_id='barnstable';
DELETE FROM manual_imports WHERE source_id='barnstable';
DELETE FROM client_cities WHERE source_id='barnstable';
DELETE FROM source_checks WHERE source_id='barnstable';
PRAGMA user_version=8;
