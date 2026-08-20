-- CallLint private usage — D1 schema (new18 §21: aggregate first).
--
-- There is deliberately NO raw event log here. A batch is folded into daily
-- counters at ingestion and the individual events are discarded, so the worst
-- case for a database compromise is coarse per-day totals plus opaque HMAC
-- hashes. There is no users/sessions/profiles table and nothing that can be
-- joined back to a machine.
--
-- Applied against the existing `calllint-usage` database (new18 §21: do not
-- create a second database without necessity). The pre-existing `usage_events`
-- table from the withdrawn Pages attempt is NOT used by this Worker; see
-- migrations/002_drop_usage_events.sql for its removal, which is a separate
-- operator-run step because it destroys data.

-- A. Daily event counts, fully aggregated. `count` is incremented in place.
CREATE TABLE IF NOT EXISTS usage_daily_counts (
  day             TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  event_name      TEXT NOT NULL,          -- closed vocabulary, re-validated server-side
  source          TEXT NOT NULL,          -- cli | ci | server | install
  host_family     TEXT NOT NULL DEFAULT '',
  input_kind      TEXT NOT NULL DEFAULT '',
  product_version TEXT NOT NULL DEFAULT '',
  count           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event_name, source, host_family, input_kind, product_version)
);

-- B. Which installations were active on a given day, and their coarse activity.
-- `installation_hash` is HMAC-SHA-256(raw id, USAGE_HASH_KEY); the raw ID is
-- discarded at ingestion and never stored (new18 §20).
CREATE TABLE IF NOT EXISTS usage_daily_installations (
  day               TEXT NOT NULL,
  installation_hash TEXT NOT NULL,
  preflights        INTEGER NOT NULL DEFAULT 0,
  attention         INTEGER NOT NULL DEFAULT 0,  -- REVIEW + BLOCK + UNKNOWN
  PRIMARY KEY (day, installation_hash)
);

-- C. Idempotency ledger. A replayed batch_id is accepted (2xx, so the client
-- clears its queue) but folded in exactly once.
CREATE TABLE IF NOT EXISTS usage_ingested_batches (
  batch_id     TEXT PRIMARY KEY,
  received_day TEXT NOT NULL
);

-- Retention scans sort by day; keep those cheap (new18 §21).
CREATE INDEX IF NOT EXISTS idx_usage_daily_counts_day
  ON usage_daily_counts (day);
CREATE INDEX IF NOT EXISTS idx_usage_daily_installations_day
  ON usage_daily_installations (day);
CREATE INDEX IF NOT EXISTS idx_usage_ingested_batches_day
  ON usage_ingested_batches (received_day);
