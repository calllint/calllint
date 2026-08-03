/**
 * refreshSnapshot — the scheduled-workflow entry point (ADR 0038 §3: ingestion is
 * the sole scanner, structurally decoupled from serving). It is the ONE place that
 * touches the network and then writes:
 *
 *   1. mirror the Official MCP Registry into the adoption index (impure edge)
 *   2. PROJECT the PII-free snapshot from the mirror and write it to SNAPSHOT_PATH
 *      (ADR 0038 §1 raw-input retention)
 *   3. MEASURE and REPORT whether the served tree needs rebuilding (§16.1/§16.2, R-2)
 *
 * It does NOT bake. That is the change R-2 made, and the reason is measured — see the
 * inverted claim below.
 *
 * The workflow then opens a PR with the diff; a human merges → CF Pages deploys. CI
 * on that PR re-bakes from the committed snapshot PURELY and diffs — so the network
 * result is frozen into a reviewable artifact, never trusted live at serve time.
 *
 * INVERTED, R-2 (do not restore). Until this batch step 3 called `emitAllCohorts` +
 * `writeServedTree` here, and its comment claimed the emitted trust and Safe-install trees
 * were "byte-identical" to `bake.ts`'s. MEASURED, they are not: 94 of the 158 committed
 * served files differ, over the SAME file set. `bake.ts:165-184` passes
 * `loadClaimStoreIfPresent()` and `loadEvidenceSnapshotIfPresent()`; this bin passed
 * `undefined, undefined, []`, so its tree was claims- and evidence-STRIPPED. The original
 * claim was true only of the two arguments it was written about — `engineVersion()` and the
 * presentation document, whose own comments at `emitCohort.ts:226-236` say they flow ONLY
 * into `installFiles` — and false of everything else.
 *
 * It never shipped a wrong page for one reason, and it is an accident of ORDERING rather
 * than a safeguard: `.github/workflows/trust-ingest.yml:49-53` runs `ingest:trust-index`,
 * then `resolve-evidence:trust-index`, then `bake:trust-index`, and `writeServedTree`
 * `rmSync`s both roots before writing — so the stripped bytes were deleted and rewritten
 * by the correct bin seconds later, inside the same job. The two committed-tree gates
 * (`test/committed-tree.test.ts:49`, `test/safe-install/committed-install-tree.test.ts:51`)
 * compare on-disk bytes against the BAKE shape, which is why the stripped shape could never
 * reach a merge.
 *
 * DELETED rather than made conditional. R-2's mandate is "replace the unconditional full
 * re-bake", and a bake of the wrong shape stays the wrong shape when it runs less often.
 * Gating it behind the change detector would have made the defect RARER, which is strictly
 * worse: a bake that emits a stripped tree on every run is found the first time anyone
 * looks, while one that does it on the runs where upstream happened to move is not.
 *
 * WHY THE MIRROR SITS IN FRONT OF THE SNAPSHOT (R-1, ADR 0061). Until this batch the
 * snapshot WAS the record of upstream, so everything the emitter dropped at ingestion —
 * deprecated servers, superseded versions, anything past the cap — was unrecoverable, and
 * the cap kept the alphabetically-first entries rather than a considered cohort. Step 1 now
 * mirrors the FULL cursor-paginated source into `source_records` and the snapshot becomes a
 * projection of it. R-0's own capability matrix names this reduction
 * (`artifacts/adoption-index-v1/current-capability-matrix.json:231` — "refreshSnapshot.ts —
 * reduce to an orchestrator over job primitives"), so the file keeps the same three steps
 * and delegates the first.
 *
 * The projection is byte-identical to what `fetchRegistrySnapshot` produced for the same
 * upstream — asserted over the shipped emitter's own output in
 * `packages/adoption-index/test/snapshot-projection.test.ts`, not claimed here. That
 * matters because these bytes feed the reproducibility gate.
 *
 * `@calllint/adoption-index` is private and carries a NATIVE driver, so this import is only
 * safe because nothing publishable reaches this module: `refreshSnapshot` is imported by no
 * source file in the repo (the one test importing this module takes `resolveMaxEntries`
 * alone), and the boundary scan asserts it rather than trusting it.
 *
 * Usage:  tsx packages/trust-index/src/refreshSnapshot.ts
 *   env:  TRUST_INGEST_NOW (ISO-8601, optional) pins fetchedAt for a reproducible run
 *         TRUST_INGEST_MIRROR_MAX_ENTRIES (optional) raises the raw-read ceiling
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  createOfficialRegistryAdapter,
  openBetterSqlite3,
  refreshFromMirror,
  resolveIndexPaths,
  describeSourceChange,
  DEFAULT_MIRROR_MAX_ENTRIES,
  MIGRATIONS_DIRNAME,
} from "@calllint/adoption-index"
import { DEFAULT_ENDPOINT, DEFAULT_MAX_ENTRIES } from "./fetchRegistry.js"
import { parseSnapshot } from "./snapshot.js"
import { SNAPSHOT_PATH } from "./bake.js"

/**
 * Resolve the ingestion cap (ADR 0038 §6). Defaults to DEFAULT_MAX_ENTRIES; an
 * operator raises it for a scale-out run via TRUST_INGEST_MAX_ENTRIES (workflow_dispatch
 * input). Fails SAFE: a missing, non-numeric, zero, or negative value falls back to the
 * default rather than fetching an unbounded / empty cohort. This is the ONLY knob for
 * 37 → 100+; it takes effect on the next real ingest run and touches no committed bytes.
 */
export function resolveMaxEntries(env: Record<string, string | undefined>): number {
  const raw = env.TRUST_INGEST_MAX_ENTRIES
  if (raw == null || raw.trim() === "") return DEFAULT_MAX_ENTRIES
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_MAX_ENTRIES
  return n
}

/**
 * Resolve the RAW-READ ceiling — a different quantity from `resolveMaxEntries`, and the
 * distinction is load-bearing.
 *
 * `TRUST_INGEST_MAX_ENTRIES` sizes the SERVED cohort: it is applied after filtering to
 * live records and sorting by name, so it selects which pages get baked. This one bounds
 * how many raw records the mirror reads at all, in arrival order, before any filter. The
 * mirror must read strictly more than the snapshot emits, because it also stores the
 * records the snapshot drops.
 *
 * Fails SAFE the same way: a missing, blank, non-integer, zero or negative value falls back
 * to the default rather than reading unbounded.
 *
 * A value that is not STRICTLY GREATER than the snapshot cap is raised to the default rather
 * than honoured, and the strictness is the point. Live records are a subset of read records,
 * so emitting N entries requires reading at least N; `paginate` reports `capReached` at
 * `yielded >= maxEntries`. An equal pair therefore makes the snapshot's own cap structurally
 * unreachable — the read fails closed on exactly the run where the snapshot would first fill.
 * Accepting `<=` would look correct and be wrong precisely when the source grows, which is
 * the same reason `DEFAULT_MIRROR_MAX_ENTRIES` is a multiple of the snapshot cap and not
 * equal to it. A configuration mistake worth correcting rather than obeying.
 */
export function resolveMirrorMaxEntries(
  env: Record<string, string | undefined>,
  snapshotMaxEntries: number,
): number {
  // The fallback is DERIVED, not the constant. `TRUST_INGEST_MAX_ENTRIES` can raise the
  // snapshot cap above `DEFAULT_MIRROR_MAX_ENTRIES`, and returning the bare constant then
  // would violate the very inequality this function exists to enforce — silently, on the
  // fallback path, which is the path a run with no mirror override takes.
  const floor = Math.max(DEFAULT_MIRROR_MAX_ENTRIES, snapshotMaxEntries + 1)
  const raw = env.TRUST_INGEST_MIRROR_MAX_ENTRIES
  if (raw == null || raw.trim() === "") return floor
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return floor
  if (n <= snapshotMaxEntries) return floor
  return n
}

/**
 * Absolute path of the adoption index's migrations directory.
 *
 * Resolved from THIS module's URL rather than from `process.cwd()`, because the store's
 * `cwd` option and its migrations source are two independent things: `cwd` decides where
 * `.var/` lands (the repo root, when this runs from the workflow), while the migrations
 * ship inside the package and must be found wherever it is installed from.
 */
function migrationsDir(): string {
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "adoption-index", MIGRATIONS_DIRNAME)
}

async function main(): Promise<void> {
  const now = process.env.TRUST_INGEST_NOW || new Date().toISOString()
  const maxEntries = resolveMaxEntries(process.env)
  const mirrorMaxEntries = resolveMirrorMaxEntries(process.env, maxEntries)

  // 1. Mirror the full source into the adoption index, then project the snapshot from it
  //    (the only network step). The store self-migrates on open, so a cold CI checkout —
  //    which every scheduled run is, since `.var/` is gitignored and never cached — takes
  //    the same path as a warm one.
  const cwd = process.cwd()
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: migrationsDir(), db, now })
  let mirrored: Awaited<ReturnType<typeof refreshFromMirror>>
  try {
    mirrored = await refreshFromMirror({
      store,
      adapter: createOfficialRegistryAdapter(DEFAULT_ENDPOINT),
      fetchImpl: fetch,
      now,
      endpoint: DEFAULT_ENDPOINT,
      snapshotMaxEntries: maxEntries,
      mirrorMaxEntries,
      mode: "full",
    })
  } finally {
    store.close()
  }

  // 2. Retain the projected snapshot. Re-parse the serialized bytes so what we bake from
  //    is exactly what we commit (no in-memory drift from the on-disk artifact).
  const snapshotText = mirrored.snapshotText
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true })
  writeFileSync(SNAPSHOT_PATH, snapshotText, "utf8")
  const committed = parseSnapshot(snapshotText)

  // 3. REPORT the change verdict. This bin measures; it does not rebuild. `bake.ts` is the
  //    one bin that bakes, because it is the one that loads the COMPLETE input set (claims,
  //    evidence, presentation), and the workflow already runs it on the next line
  //    (`trust-ingest.yml:53`). The verdict is stdout, not an exit code: a run that mirrored
  //    successfully and found nothing changed SUCCEEDED, and reporting that as a failure
  //    would make the common case red.
  const change = mirrored.change

  // eslint-disable-next-line no-console
  console.log(
    `mirror: ${mirrored.sync.records} record(s) read (${mirrored.sync.persisted.inserted} new, ` +
      `${mirrored.sync.persisted.unchanged} unchanged), ${mirrored.mirroredRecords} row(s) stored, ` +
      `${mirrored.currentSubjects} current subject(s); ` +
      `snapshot: ${committed.count} entry(ies) @ ${committed.fetchedAt}; ` +
      `cohort digest ${mirrored.snapshotDigest}; ` +
      `${describeSourceChange(change)}`,
  )
}

// Run ONLY when executed as a script (tsx src/refreshSnapshot.ts), never on import — the
// same guard `bake.ts:196` and `resolveEvidence.ts:88` already carry, and this module needs
// it MORE than either of them: `main()` opens a SQLite database under `.var/`, fetches the
// live registry, and rewrites the committed snapshot. `expansion-eligibility.test.ts` imports
// this file for `resolveMaxEntries`/`resolveMirrorMaxEntries` alone, and without the guard
// that import performed a real network read and left `.var/calllint-adoption-index/` behind —
// a test that passed only because the rejection landed after the suite had finished.
const invokedAsScript =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedAsScript) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
}
