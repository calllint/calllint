/**
 * projectAdoptionIndex — freeze the identity plane of the canonical adoption graph into a committed
 * document (`packages/trust-index/snapshots/adoption-index.json`), so the bake can read it PURELY.
 *
 * This is the impure edge, and it is the ONLY thing in the serving pipeline that opens the
 * compiler's database. ADR 0061 §5: "nothing served ever queries the compiler … A request for a
 * Trust page must never cause a database read." The bake reads the committed file, so
 * `(committed projection) → (baked bytes)` stays a pure function and the reproducibility diff gate
 * (ADR 0046 §4) is unaffected — the same division `resolveEvidence.ts` already uses for evidence.
 *
 * WHY THERE ARE TWO INPUT PATHS, and why that is not a fallback bolted on for convenience.
 *
 *   - IN THE WORKFLOW the store is full. `trust-ingest.yml` runs `ingest:trust-index` —
 *     `refreshSnapshot.ts`, whose `refreshFromMirror` calls `persistIdentity` — before this step,
 *     so `canonical_subjects` holds the mirrored cohort and reading it is reading the real thing,
 *     including a `firstSeenAt` history no derivation can reconstruct.
 *   - EVERYWHERE ELSE the store is empty, and MEASURED so rather than assumed: `.var/` is
 *     gitignored and never cached between jobs, so on a cold checkout all ten tables are at zero.
 *     A bin that only read the store would therefore emit nothing on every machine except the
 *     scheduled runner — green in the workflow, empty for every developer and every CI leg.
 *
 * So the second path DERIVES the identity plane from the committed registry snapshot
 * (`deriveSubjectsFromSnapshot`, pure). The two paths are not two definitions of identity: the
 * derivation calls the store's own `subjectSlugRow` / `subjectIdentityDigest`, which is what
 * `persistIdentity` writes its two columns with, so a derived row and a persisted row agree by
 * construction. What the derivation cannot reproduce is `firstSeenAt` history — which is exactly
 * why the projection carries `lastSeenAt` and not `firstSeenAt`.
 *
 * WHICH PATH RUNS IS AN EXPLICIT CHOICE, NOT A CONSEQUENCE OF WHAT THE STORE HOLDS. `--from-snapshot`
 * never opens the store; the default reads it and derives only if it is empty. That split is what the
 * `FROM_SNAPSHOT_FLAG` docblock below exists to justify, and it was forced by measurement: a
 * store-first default committed 298 subjects on a machine with a warm `.var/` where the snapshot
 * derives 19.
 *
 * NEITHER PATH WRITES AN EMPTY DOCUMENT. If the store is empty AND no snapshot is committed, this
 * logs and returns — the same refusal `resolveEvidence.ts` makes on a missing snapshot. A failed or
 * half-finished compiler run must not blank the committed identity of 19 live subjects; an absent
 * file makes the bake fall back to today's byte-identical output, while an empty one would silently
 * withdraw every subject's identity (control #112).
 *
 * IDENTITY ONLY — NEVER A VERDICT. `projectAdoptionIndex` (the pure function this bin is named
 * after) enumerates the decision fields it refuses to carry, and `parseAdoptionIndex` restates the
 * refusal on the consuming side. ADR 0061 §4: the adoption graph "has no opinion about whether that
 * subject is safe"; `computeVerdict` is the only verdict engine, every time.
 *
 * Usage:  tsx packages/trust-index/src/projectAdoptionIndex.ts [--from-snapshot]
 *         `pnpm project-adoption-index:trust-index`        → --from-snapshot (regenerates the
 *                                                             committed artifact; pure, offline)
 *         `pnpm project-adoption-index:trust-index:store`  → the store (what `trust-ingest.yml` runs)
 *   env:  TRUST_INGEST_NOW (ISO-8601, optional) pins `projectedAt` for a reproducible store run
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AdoptionIndexStore,
  MIGRATIONS_DIRNAME,
  deriveSubjectsFromSnapshot,
  openBetterSqlite3,
  projectAdoptionIndex,
  resolveIndexPaths,
  serializeAdoptionIndex,
  type StoredAdoptionRecord,
  type StoredSubject,
} from "@calllint/adoption-index"
import { ADOPTION_INDEX_PATH, loadSnapshotIfPresent } from "./bake.js"

/**
 * Absolute path of the adoption index's migrations directory — resolved from THIS module's URL,
 * not `process.cwd()`, for the reason `refreshSnapshot.ts` states: `cwd` decides where `.var/`
 * lands, while the migrations ship inside the package and must be found wherever it is installed
 * from.
 */
function migrationsDir(): string {
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "adoption-index", MIGRATIONS_DIRNAME)
}

/**
 * `--from-snapshot` — derive from the committed registry snapshot and do not open the store at all.
 *
 * THIS FLAG EXISTS BECAUSE THE STORE-FIRST DEFAULT PRODUCED AN UNREPRODUCIBLE ARTIFACT, measured
 * rather than foreseen. Run on this machine with a warm `.var/`, the store path emitted 298 subjects
 * stamped with a wall clock, while the committed snapshot beside it derives 19 — and the snapshot's
 * own `io.github.calllint/calllint` was absent from the 298, so the two are different OBSERVATIONS,
 * not a superset and a subset. A committed artifact whose bytes depend on whatever a local database
 * happens to hold cannot be byte-compared by anyone, which is the whole point of committing it.
 *
 * So the two paths are split by INTENT rather than by what the store happens to contain:
 *   - `--from-snapshot` (what the reproducibility gate and every human re-derive use): a pure
 *     function of committed bytes. Stamped `snapshot.fetchedAt`, so re-running changes nothing.
 *   - the default (what `trust-ingest.yml` uses, one step after `ingest:trust-index` refreshed both
 *     the mirror AND the snapshot): the store, with the real `firstSeenAt` history a derivation
 *     cannot reconstruct. There the two agree because the snapshot was just written from the same
 *     mirror walk.
 */
const FROM_SNAPSHOT_FLAG = "--from-snapshot"

/** What one run read, and from where — returned rather than logged so `main` owns the reporting. */
interface Inputs {
  subjects: StoredSubject[]
  records: StoredAdoptionRecord[]
  origin: "store" | "snapshot"
  /**
   * The stamp to project under, decided by whichever path produced the rows.
   *
   * Carried here rather than recomputed in `main`, because the two paths disagree and the
   * disagreement is load-bearing: a store read is an observation made NOW, while a derivation is an
   * observation of the committed snapshot and must be stamped with the snapshot's own `fetchedAt`
   * or the committed document's bytes would move on every run and the re-derive gate could never
   * compare them.
   */
  projectedAt: string
}

/**
 * Why this run must not write — `null` when it may. A PURE PREDICATE, exported for one reason: it is
 * the rule that keeps a failed compiler run from blanking 19 live subjects' identity, and a rule with
 * no test is a comment.
 *
 * IT IS SEPARATE FROM `main` BECAUSE THE ALTERNATIVE WAS UNTESTABLE. The refusal used to be two
 * inline `return`s inside `main`, which is not exported and is fenced behind `invokedAsScript`; the
 * only way to reach it was to spawn `tsx` and let it open a SQLite database, which neither this
 * package's tests nor `adoption-index`'s do (the latter actively scans for `child_process`). Control
 * #112 measured the consequence: deleting BOTH refusals left 1447/1447 green. So the decision moved
 * out of the I/O and into a function that can be called with a value.
 *
 * WRITING NOTHING IS NOT THE SAME FAILURE AS WRITING NOTHING DOWN. An absent file makes the bake fall
 * back to today's byte-identical output (`adoptionMap(null)` is empty), so a refusal costs one stale
 * run. An empty document is a positive claim that no subject has an identity, and it would silently
 * withdraw all 19 — which is why this returns a reason rather than a boolean, and why `main` prints
 * it: an operator has to be able to tell "nothing to do" from "I declined to erase your data".
 */
export function refuseToProject(inputs: Inputs | null): string | null {
  if (inputs === null) return "no canonical subjects and no committed snapshot — nothing to project"
  if (inputs.subjects.length === 0) {
    // Reachable only from a committed snapshot with zero entries. Stated separately so the log names
    // which of the two emptinesses happened.
    return "snapshot carries no entries — refusing to write an empty adoption index"
  }
  return null
}

/**
 * Derive the identity plane from the committed registry snapshot — pure, and the ONLY path whose
 * output is a function of committed bytes alone.
 *
 * Stamped `snapshot.fetchedAt` rather than the clock: the derived identity is an observation of the
 * COMMITTED snapshot, so a wall-clock stamp would claim a freshness the bytes do not have AND would
 * move `projectedAt` on every run, leaving the re-derive gate nothing stable to compare.
 */
function fromSnapshot(): Inputs | null {
  const snapshot = loadSnapshotIfPresent()
  if (!snapshot) return null
  return {
    subjects: deriveSubjectsFromSnapshot({ entries: snapshot.entries, observedAt: snapshot.fetchedAt }),
    records: [],
    origin: "snapshot",
    projectedAt: snapshot.fetchedAt,
  }
}

/**
 * Read the identity plane from the store, falling back to the committed snapshot when the store
 * holds no subjects. Returns `null` when neither has anything — the caller must then write nothing.
 *
 * The store is opened even when it is expected to be empty, because "expected" is the assumption
 * this batch already had to correct once: the store self-migrates on open, so a cold checkout takes
 * the same path as a warm one and the emptiness is MEASURED per run rather than inferred from the
 * environment.
 */
async function readFromStore(now: string): Promise<Inputs | null> {
  const cwd = process.cwd()
  const paths = resolveIndexPaths(cwd)
  for (const dir of paths.dirs) mkdirSync(dir, { recursive: true })
  const db = await openBetterSqlite3(paths.db)
  const store = AdoptionIndexStore.open({ cwd, migrationsDir: migrationsDir(), db, now })
  let subjects: StoredSubject[]
  let records: StoredAdoptionRecord[]
  try {
    subjects = store.listSubjects()
    // Read unconditionally, and today this is empty on every path: nothing in any package's `src/`
    // compiles a record yet. Reading it anyway means the record-bearing branch is wired the day a
    // decision port lands, with no change here — rather than a second code path added later.
    records = store.listAdoptionRecords()
  } finally {
    store.close()
  }
  if (subjects.length > 0) return { subjects, records, origin: "store", projectedAt: now }
  // An empty store is not an error — on a cold checkout it is the norm (`.var/` is gitignored and
  // never cached between jobs). Fall through to the same derivation `--from-snapshot` uses, so the
  // two paths cannot drift into two definitions of identity.
  return fromSnapshot()
}

async function main(): Promise<void> {
  const now = process.env.TRUST_INGEST_NOW || new Date().toISOString()
  const fromSnapshotOnly = process.argv.slice(2).includes(FROM_SNAPSHOT_FLAG)
  // Dispatched on INTENT, not on what the store holds: `--from-snapshot` must not open the store at
  // all, or a warm `.var/` on a developer's machine would still decide the committed bytes.
  const inputs = fromSnapshotOnly ? fromSnapshot() : await readFromStore(now)
  const refusal = refuseToProject(inputs)
  if (refusal !== null || inputs === null) {
    // `inputs === null` is re-tested only to narrow the type — `refuseToProject` already returned a
    // reason for it, and the two conditions cannot disagree.
    // eslint-disable-next-line no-console
    console.log(refusal)
    return
  }

  const doc = projectAdoptionIndex({
    subjects: inputs.subjects,
    records: inputs.records,
    projectedAt: inputs.projectedAt,
  })

  mkdirSync(dirname(ADOPTION_INDEX_PATH), { recursive: true })
  writeFileSync(ADOPTION_INDEX_PATH, serializeAdoptionIndex(doc), "utf8")

  const enriched = doc.entries.filter((e) => e.adoptionRecordDigest !== undefined).length
  // eslint-disable-next-line no-console
  console.log(
    `projected ${doc.count} canonical subject(s) from the ${inputs.origin} ` +
      `(${enriched} with a compiled record) → ${ADOPTION_INDEX_PATH}`,
  )
}

// Run ONLY when executed as a script, never on import — this opens a SQLite database under `.var/`
// and rewrites a committed artifact. The same guard `refreshSnapshot.ts`, `bake.ts` and
// `resolveEvidence.ts` carry.
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
