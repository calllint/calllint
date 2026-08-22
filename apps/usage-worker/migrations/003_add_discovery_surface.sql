-- Add `discovery_surface` to the daily count rows (new19 §21).
--
-- WHY THIS IS A NEW COLUMN IN THE PRIMARY KEY, NOT A SIDECAR TABLE
-- `usage_daily_counts` IS the aggregate: a row is one (day × dimensions) counter.
-- A dimension that is stored but not in the PK would let two different dimension
-- combinations collide on the same key, and `DO UPDATE SET count = count + excluded.count`
-- would silently merge them — the exact cardinality-understating bug the aggregation
-- tests exist to prevent. So the column joins the key.
--
-- WHY `''` AND NOT NULL. The ingress normalizes an absent dimension to the empty
-- string, matching host_family / input_kind / product_version. SQLite treats NULLs as
-- distinct in a UNIQUE/PK comparison, so a nullable column would make every
-- unattributed row its own key and defeat the upsert.
--
-- VALUE SPACE IS CLOSED, and that is a privacy control rather than a nicety. The value
-- is one of the six surface TYPES in agent-discovery-index.json's `surfaceTypes` —
-- never a surface id. Ids are per-host and 23 of them exist; at that cardinality a
-- daily row approaches single-install granularity, and `io.github.calllint/calllint`
-- would not even pass the ingress's safe-token rule (it contains `/`). validate.ts
-- enum-checks the value on arrival, so a hostile client cannot mint unbounded new
-- primary keys in this table.
--
-- NOT DESTRUCTIVE, and safe to run against a populated table: existing rows take the
-- `''` default, so pre-migration counters stay valid and simply read as "surface not
-- stated". SQLite cannot add a column to an existing PRIMARY KEY in place, so this
-- rebuilds the table and copies the rows over.
--
-- NOT YET APPLIED. This is conduit-only (new19 §21 stays open until the Worker is
-- deployed). Applying it is an operator step:
--
--   wrangler d1 migrations apply calllint-usage --remote

-- Rebuild with the wider key, preserving every existing counter.
CREATE TABLE IF NOT EXISTS usage_daily_counts_new (
  day               TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  event_name        TEXT NOT NULL,          -- closed vocabulary, re-validated server-side
  source            TEXT NOT NULL,          -- cli | ci | server | install
  host_family       TEXT NOT NULL DEFAULT '',
  input_kind        TEXT NOT NULL DEFAULT '',
  product_version   TEXT NOT NULL DEFAULT '',
  -- '' | agent-harness | mcp-registry | marketplace | documentation | search-surface | mirror
  discovery_surface TEXT NOT NULL DEFAULT '',
  count             INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event_name, source, host_family, input_kind, product_version, discovery_surface)
);

INSERT INTO usage_daily_counts_new
  (day, event_name, source, host_family, input_kind, product_version, discovery_surface, count)
SELECT day, event_name, source, host_family, input_kind, product_version, '', count
FROM usage_daily_counts;

DROP TABLE usage_daily_counts;

ALTER TABLE usage_daily_counts_new RENAME TO usage_daily_counts;

-- Recreate the retention index dropped with the old table (new18 §21).
CREATE INDEX IF NOT EXISTS idx_usage_daily_counts_day
  ON usage_daily_counts (day);
