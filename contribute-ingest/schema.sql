CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  schema_version INTEGER NOT NULL,
  run_count INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS contributions_received_at ON contributions (received_at);
