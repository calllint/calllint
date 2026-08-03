-- 001-canonical-adoption-graph — the canonical Workstream R schema, verbatim from
-- the execution plan §10.2 (all ten tables).
--
-- WHY ALL TEN, when R-1 populates only the first two: a later batch owning a table is
-- not a reason to omit it. Adding eight tables across eight later migrations is eight
-- chances to diverge from the canonical DDL, and a divergence in a table that nothing
-- reads yet is invisible until the batch that finally reads it. The schema is a
-- contract; it lands whole and is asserted against §10.2 by test.
--
-- Migrations are numbered, FORWARD-ONLY, and applied inside a transaction. There is
-- no `down`: this store is a derived mirror under `.var/` (INV-R7), so the recovery
-- procedure for a bad migration is "delete the store and recompile from source",
-- which is always available and cannot half-apply. A `down` that is never exercised
-- is a liability, not a safety net.
--
-- Column types follow §10.2 exactly, including TEXT for every timestamp. Timestamps
-- are ISO-8601 strings supplied by the caller, never `CURRENT_TIMESTAMP` — a
-- wall-clock read inside the compile path would break reproducibility (INV-R6, §9.5).

CREATE TABLE source_records (
  source_record_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_native_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(source_id, source_native_id, payload_digest)
);

CREATE TABLE source_checkpoints (
  source_id TEXT PRIMARY KEY,
  cursor TEXT,
  updated_since TEXT,
  snapshot_digest TEXT,
  last_started_at TEXT,
  last_completed_at TEXT,
  status TEXT NOT NULL,
  last_error_code TEXT
);

CREATE TABLE canonical_subjects (
  subject_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  canonical_slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  identity_status TEXT NOT NULL,
  identity_digest TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE subject_aliases (
  alias TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  source_record_id TEXT,
  alias_type TEXT NOT NULL,
  PRIMARY KEY(alias, subject_id)
);

CREATE TABLE artifact_versions (
  artifact_version_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  package_type TEXT NOT NULL,
  package_identifier TEXT NOT NULL,
  version TEXT,
  source_locator TEXT NOT NULL,
  immutable_digest TEXT,
  registry_integrity TEXT,
  artifact_status TEXT NOT NULL,
  cache_key TEXT,
  first_seen_at TEXT NOT NULL,
  last_verified_at TEXT
);

CREATE TABLE evidence_records (
  evidence_digest TEXT PRIMARY KEY,
  artifact_version_id TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  verdict TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE adoption_records (
  subject_id TEXT PRIMARY KEY,
  selected_artifact_version_id TEXT,
  adoption_record_digest TEXT NOT NULL,
  decision_digest TEXT NOT NULL,
  semantic_contract_digest TEXT,
  presentation_digest TEXT,
  lifecycle_status TEXT NOT NULL,
  record_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE identity_conflicts (
  conflict_id TEXT PRIMARY KEY,
  subject_key TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  source_record_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_json TEXT
);

CREATE TABLE compiler_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  state TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  last_error_digest TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_type, subject_key, input_digest)
);

CREATE TABLE compiler_runs (
  run_id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL,
  input_manifest_digest TEXT NOT NULL,
  output_manifest_digest TEXT,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  metrics_json TEXT NOT NULL
);
