-- CallLint Usage Observatory — D1 Schema
-- Privacy-first: raw installation IDs are NEVER persisted
-- Only HMAC(installationId, secret) is stored

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT UNIQUE NOT NULL,
  hashed_installation_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL,
  host_family TEXT,
  result TEXT,
  duration_bucket TEXT,
  input_kind TEXT,
  product_version TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hashed_id ON usage_events(hashed_installation_id);
CREATE INDEX IF NOT EXISTS idx_event_name ON usage_events(event_name);
CREATE INDEX IF NOT EXISTS idx_timestamp ON usage_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_created_at ON usage_events(created_at);

-- Aggregate-only view: never expose raw events
-- This is the ONLY surface the private dashboard queries
CREATE VIEW IF NOT EXISTS usage_aggregates AS
SELECT
  event_name,
  COUNT(DISTINCT hashed_installation_id) as unique_installations,
  COUNT(*) as total_events,
  DATE(timestamp) as event_date
FROM usage_events
WHERE timestamp >= datetime('now', '-90 days')
GROUP BY event_name, DATE(timestamp);

-- Active installations (last 30 days)
CREATE VIEW IF NOT EXISTS active_installations AS
SELECT
  COUNT(DISTINCT hashed_installation_id) as count
FROM usage_events
WHERE timestamp >= datetime('now', '-30 days');
