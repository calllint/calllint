-- 002-nullable-canonical-slug — let `canonical_subjects.canonical_slug` be NULL, keeping
-- its UNIQUE, so a REFUSED identity can be RECORDED instead of crashing the cohort write.
--
-- THIS IS A DELIBERATE DEVIATION FROM THE EXECUTION PLAN §10.2, which declares
-- `canonical_slug TEXT NOT NULL UNIQUE`. The argument is recorded here because a deviation
-- without one is indistinguishable from a drift, and 001's header states the schema is a
-- contract asserted against §10.2 by test.
--
-- THE DEFECT, precisely. It is not that slugs collide — four layers already say they may:
--
--   * `domain/subject.ts` types `canonicalSlug` with "May COLLIDE — see above";
--   * `registryCohort.ts`'s `registryCollisions()` returns a collision as a reportable
--     VALUE and never as a key, which is the shape this table contradicts;
--   * `resolveIdentity` detects a slug collision PRE-PERSIST (class 2), emits an
--     `identity_conflicts` row naming every participant, marks each participant's subject
--     `CONFLICT`, and withholds all of their artifact rows;
--   * `canonicalName` is documented as "The AUTHORITATIVE key: the original registry name,
--     never the lossy slug".
--
-- The defect is that R-3's FAIL-CLOSED PATH EMITS OUTPUT ITS OWN SCHEMA CANNOT STORE. Both
-- contesting subjects are still pushed — correctly, since dropping one would turn a refusal
-- into a silent omission — each carrying the SAME derived slug, at a NOT NULL UNIQUE column,
-- inside ONE transaction. So the refusal ROLLS BACK THE ENTIRE COHORT rather than being
-- recorded. The storage layer is the only layer that disagrees, and it disagrees by crashing.
--
-- WHY THIS IS REACHABLE NOW, and was not before. R-3 resolved identity over the 19 committed
-- snapshot entries: 19 names, 19 distinct slugs, 0 collisions. The companion cap raise in this
-- change fans resolution out to the source's full live cohort (19_739 `active` + `isLatest`
-- names, measured 2026-08-04 by a walk that ran to `reason=exhausted`), where collisions are
-- MEASURED, not hypothetical. A probe over 50_000 of the source's 65_235 records found two:
--
--   io.github.LocalSynapse/LocalSynapse-mcp  vs  io.github.LocalSynapse/localsynapse-mcp
--   io.github.Zuga-luga/Zugabot              vs  io.github.Zuga-luga/zugabot
--
-- Both are CASE-FOLD collisions — the slug lowercases, and the registry does not. TWO IS A
-- FLOOR, NOT A COUNT: that probe stopped at its own 500-page ceiling, so it saw 14_454 of the
-- 19_739 live names. (House rule, earned three times on this workstream: suspect the probe
-- before the source. The figures 21_000 and "50_000+" were both probe ceilings misread as
-- measurements.)
--
-- WHY NULLABLE-BUT-STILL-UNIQUE IS THE RIGHT SHAPE. SQLite treats NULLs as DISTINCT under a
-- UNIQUE constraint — verified empirically against this package's own pinned driver
-- (better-sqlite3, sqlite 3.53.0): three NULLs were accepted in a UNIQUE column while a
-- duplicate non-NULL was still refused. So the TRUE invariant survives untouched — one
-- address, one owner; two subjects may never claim the same concluded slug — while the column
-- gains the ability to say "no address was concluded". That is exactly, and only, what
-- `identity_status = 'CONFLICT'` already means. The constraint that was doing real work keeps
-- doing it; the one that was crashing the fail-closed path stops.
--
-- THE DOCUMENT SHAPE DOES NOT CHANGE, and must not. `calllint.canonical-subject.v1` requires
-- `canonicalSlug` as `{"type": "string", "minLength": 1}` — required, non-nullable — and it is
-- a PUBLISHED schema (`$id` under calllint.com/schemas/) behind a compatibility gate. So the
-- divergence lives HERE, in storage, joining the three document/storage divergences 001 and
-- `domain/subject.ts` already enumerate: `identity_digest` is a NOT NULL column the schema
-- forbids as a property; `sourceRecordIds`/`identityBasis` are schema properties with no
-- columns; `artifact_versions` diverges in both directions. A fourth is not a new kind of
-- thing. The subject DOCUMENT still always carries a slug; the ROW omits it when the identity
-- was refused, and `store.ts` is where that translation is made and asserted.
--
-- WHY A NEW MIGRATION RATHER THAN AN EDIT TO 001. `applyMigrations` digest-pins each
-- migration's bytes on apply and re-checks before applying, so editing 001 in place THROWS for
-- any store that already ran it. Forward-only means the fix is a new file — enforced by code,
-- not remembered. This also leaves `CANONICAL_MIGRATION_DIGEST` (the by-value pin on 001 in
-- `test/store-schema.test.ts`) UNMOVED, which is the point: 001's bytes are still exactly the
-- bytes that were reviewed.
--
-- SQLITE CANNOT DROP NOT NULL IN PLACE — there is no `ALTER COLUMN` — so this is the standard
-- twelve-step table rebuild, minus the steps that do not apply: there are no indexes, no
-- triggers, and no views on this table, and the whole file runs inside ONE transaction opened
-- by `applyMigrations`. `PRAGMA foreign_keys` is deliberately NOT touched: 001 declares no
-- FOREIGN KEY anywhere (identity is enforced in `resolveIdentity`, which is why its docblock
-- says the invariant "has to hold HERE or it does not hold at all"), so no child row can be
-- orphaned by the drop-and-rename, and issuing a pragma inside a transaction would be a no-op
-- that read as protection.
--
-- Column order, types, and every other constraint are preserved EXACTLY as 001 declared them.
-- The single byte of difference is the absent NOT NULL on `canonical_slug`.

CREATE TABLE canonical_subjects_new (
  subject_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  canonical_slug TEXT UNIQUE,
  display_name TEXT NOT NULL,
  identity_status TEXT NOT NULL,
  identity_digest TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Columns named explicitly on BOTH sides. `INSERT INTO … SELECT *` would silently depend on
-- declaration order matching, which is the one thing a rebuild migration is most able to get
-- wrong and least able to notice.
INSERT INTO canonical_subjects_new (
  subject_id, canonical_name, canonical_slug, display_name,
  identity_status, identity_digest, first_seen_at, last_seen_at
)
SELECT
  subject_id, canonical_name, canonical_slug, display_name,
  identity_status, identity_digest, first_seen_at, last_seen_at
FROM canonical_subjects;

DROP TABLE canonical_subjects;

ALTER TABLE canonical_subjects_new RENAME TO canonical_subjects;
