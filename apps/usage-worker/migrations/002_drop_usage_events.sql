-- Remove the raw event log left by the withdrawn Pages Functions attempt.
--
-- new18 §21 forbids an indefinite raw event log. `usage_events` was created by
-- the earlier functions/schema.sql, and its two views read from it. Nothing in
-- apps/usage-worker touches it.
--
-- This migration is DESTRUCTIVE and is therefore NOT applied by the deploy
-- workflow. Run it manually only after confirming the table is empty:
--
--   wrangler d1 execute calllint-usage --remote \
--     --command "SELECT COUNT(*) FROM usage_events"
--
-- The table is expected to be empty: /v1/events/usage was never routed, so no
-- batch ever reached a handler. If the count is non-zero, stop and inspect
-- before dropping — that would mean the ingress ran at some point and the rows
-- are unaggregated raw events subject to §21 retention.

DROP VIEW IF EXISTS usage_aggregates;
DROP VIEW IF EXISTS active_installations;
DROP TABLE IF EXISTS usage_events;
