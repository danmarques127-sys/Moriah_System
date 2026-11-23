CREATE TABLE IF NOT EXISTS financial_entries(
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 entry_date TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('income','expense')),
 category TEXT NOT NULL,
 description TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 project_id TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS financial_workspace_date ON financial_entries(workspace_id,entry_date);
CREATE TABLE IF NOT EXISTS employees(
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 name TEXT NOT NULL,
 hourly_cents INTEGER NOT NULL CHECK(hourly_cents>=0),
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS employees_workspace ON employees(workspace_id);
CREATE TABLE IF NOT EXISTS time_entries(
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 employee_id TEXT NOT NULL REFERENCES employees(id),
 work_date TEXT NOT NULL,
 hours_minutes INTEGER NOT NULL CHECK(hours_minutes>0 AND hours_minutes<=1440),
 project_id TEXT,
 notes TEXT NOT NULL DEFAULT '',
 hourly_cents INTEGER NOT NULL CHECK(hourly_cents>=0),
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS time_workspace_date ON time_entries(workspace_id,work_date);
PRAGMA user_version=2;
