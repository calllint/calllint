/**
 * paths — the ONE place that decides where the adoption index persists.
 *
 * INV-R7: the compiler's entire persistence lives under `.var/calllint-adoption-index/`
 * and it writes NOTHING outside that root. The Trust Gateway remains the only writer of
 * host configuration; this store writes no host config at all.
 *
 * That invariant is only credible if a single function owns the layout, so every path
 * below is derived from `root` and `resolveIndexRoot` is the only entry point. A module
 * that joined its own path would put a write outside the audited set, and the negative
 * control for INV-R7 (control #12) would have nothing to measure.
 *
 * The directory shape is §11.1, verbatim.
 */
import { resolve } from "node:path"

/** The persistence root, relative to a repo/service working directory (INV-R7). */
export const INDEX_ROOT_DIRNAME = ".var/calllint-adoption-index"

/** The subdirectories §11.1 declares. Created eagerly so no writer has to mkdir -p. */
export const INDEX_SUBDIRS = [
  "db",
  "cas/blobs",
  "cas/expanded",
  "cas/manifests",
  "work",
  "dead-letter",
  "reports",
  "locks",
] as const

export interface IndexPaths {
  /** Absolute path of `.var/calllint-adoption-index`. */
  root: string
  /** Absolute path of the SQLite database file (§11.1 `db/adoption-index.sqlite`). */
  db: string
  /** Absolute paths of every declared subdirectory, in declaration order. */
  dirs: string[]
}

/**
 * Resolve the index layout beneath `cwd`.
 *
 * `cwd` is a parameter rather than a `process.cwd()` read so that a test can point the
 * store at a temp directory without setting a global, and so that the systemd unit in
 * R-9 can point it at a service data dir. Defaulting it here would make the temp-dir
 * test depend on process state, which is the kind of ambient coupling that makes a
 * "writes nothing outside root" assertion untestable.
 */
export function resolveIndexPaths(cwd: string): IndexPaths {
  const root = resolve(cwd, INDEX_ROOT_DIRNAME)
  return {
    root,
    db: resolve(root, "db", "adoption-index.sqlite"),
    dirs: INDEX_SUBDIRS.map((d) => resolve(root, d)),
  }
}

/**
 * The content-addressed path of one verified blob, `cas/blobs/<hex[0:2]>/<hex>`.
 *
 * It lives here, and not in the CAS writer, because INV-R7's credibility rests on a single
 * owner of the layout (see the module docblock) — a writer that joined its own path would put
 * a write outside the audited set. The two-character fan-out keeps any one directory small
 * enough that a listing stays cheap at expansion scale.
 *
 * `digest` must be this repo's `sha256:<hex>` convention. A digest in any other shape is a
 * programming error rather than bad input — the only callers are internal, and the digest they
 * pass is one `sha256Bytes` just produced — so this throws instead of returning a refusal. The
 * hex is validated because it becomes a path segment: accepting arbitrary text here is what
 * turns a digest bug into a write outside the root, which is exactly what control #30 checks.
 */
/**
 * The root of the content-addressed blob tree, `cas/blobs`.
 *
 * It exists for the same reason `casBlobPath` does: INV-R7 gives the layout ONE owner. The
 * retention sweep (`casRetention.ts`) has to enumerate the tree rather than address one blob, and
 * a sweep that joined `"cas", "blobs"` itself would be a second definition of the layout — the
 * exact drift the invariant exists to prevent. Whatever `casBlobPath` writes under, this returns.
 */
export function casBlobsRoot(root: string): string {
  return resolve(root, "cas", "blobs")
}

export function casBlobPath(root: string, digest: string): string {
  const hex = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : ""
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`casBlobPath: expected a "sha256:<64 hex>" digest, received ${JSON.stringify(digest)}`)
  }
  return resolve(root, "cas", "blobs", hex.slice(0, 2), hex)
}

/**
 * The staging path a blob is written to before it is renamed into place.
 *
 * The temp name is the digest itself: deterministic, so no clock and no `Math.random` enter the
 * store, and idempotent, so two concurrent writes of identical content cannot collide on a name
 * while carrying different bytes.
 */
export function casStagingPath(root: string, digest: string): string {
  const hex = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : ""
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`casStagingPath: expected a "sha256:<64 hex>" digest, received ${JSON.stringify(digest)}`)
  }
  return resolve(root, "work", `${hex}.part`)
}

/**
 * The root of the staging tree, `work` — the directory `casStagingPath` writes into.
 *
 * Same argument as `casBlobsRoot`: INV-R7 gives the layout ONE owner, and the ADR 0061 §8.6 orphan
 * sweep has to ENUMERATE this directory rather than address one file in it. A sweep that joined
 * `"work"` itself would be a second definition of the layout, and the first one to drift would do
 * so silently — it would simply sweep a directory nothing writes to and report `inspected 0`
 * forever, which is the failure mode §8.5 already measured for a mis-rooted CAS sweep.
 *
 * Note the asymmetry with `casBlobsRoot`: that tree is a two-character fan-out, this one is flat.
 * Callers must not assume a shared traversal shape.
 */
export function casWorkRoot(root: string): string {
  return resolve(root, "work")
}

/**
 * The root of the run-report tree, `reports` — where a completed compile run records what it did.
 *
 * Same single-owner argument as `casBlobsRoot` and `casWorkRoot` (INV-R7), but this one is worth
 * spelling out because the directory was declared in `INDEX_SUBDIRS` from the first commit and had
 * **no writer and no path helper** until now, while `scripts/gate-s1.ts:438` was already counting
 * files in it. A reader over an unwritten directory is the repo's dominant fault class: it reads 0
 * forever and nothing distinguishes a quiet run from a writer that was never built.
 *
 * Flat, like `work` and unlike the two-character fan-out of `cas/blobs`: reports are keyed by run,
 * and a run count stays small enough that a listing is cheap. Callers must not assume a shared
 * traversal shape across these three roots.
 */
export function reportsRoot(root: string): string {
  return resolve(root, "reports")
}

/**
 * Encode a run id into ONE filename-safe path segment, shared by both projections of a run.
 *
 * IT ACCEPTS WHAT THE MINTER ACTUALLY MINTS, which the first version did not. `compilerRunId` is
 * `hashJson(...)` (`domain/job.ts:266`), so every real run id is `sha256:<64 hex>` — and the regex
 * here forbade `:`. Both callers below therefore threw on EVERY production run; their writers catch
 * and log, so `reports/` and `cas/manifests/` stayed EMPTY while `scripts/gate-s1.ts` censused them
 * and `scripts/gate-s2.ts` globbed them for its newest report. `runReportPath`'s docblock named
 * `beginCompilerRun` as the authority on the shape, and the regex never asked it.
 *
 * The colon becomes `-`: legal in a POSIX filename but NOT on Windows (drive / ADS separator), where
 * this repo also runs. `sha256` is kept rather than stripped so the algorithm stays legible if a
 * later digest is not sha256, and the mapping is injective, so one filename still names one run.
 *
 * SHARED, where the two validators were duplicated on purpose. That comment argued a shared helper
 * would turn a future divergence into a silent path change — but the reason the two names must match
 * is that the two projections of one run JOIN on their filename, so a divergence in the ENCODING
 * breaks that join silently, which is the worse of the two failures. Duplicating a validator is
 * cheap; duplicating an encoder makes the join hold by coincidence.
 */
function runIdSegment(runId: string, caller: string): string {
  if (/^sha256:[0-9a-f]{64}$/.test(runId)) return runId.replace(":", "-")
  if (/^[0-9a-zA-Z][0-9a-zA-Z._-]{0,127}$/.test(runId)) return runId
  throw new Error(`${caller}: expected a filename-safe run id, received ${JSON.stringify(runId)}`)
}

/**
 * The path of one run's report, `reports/run-<id>.json`.
 *
 * The run id is validated because it becomes a path segment — the same reason `casBlobPath`
 * validates its hex. Run ids are internal (`beginCompilerRun` mints them), so a malformed one is a
 * programming error rather than bad input, and this throws instead of returning a refusal.
 */
export function runReportPath(root: string, runId: string): string {
  return resolve(reportsRoot(root), `run-${runIdSegment(runId, "runReportPath")}.json`)
}

/**
 * The root of the CAS manifest tree, `cas/manifests` — what one run REFERENCED in the blob store.
 *
 * The fourth directory in this file to get a helper, and the third to have been declared in
 * `INDEX_SUBDIRS` from the first commit with no writer behind it. `reportsRoot`'s docblock names the
 * fault class; this one is its next instance, and it was found by the guard the last one produced:
 * `scripts/gate-s1.ts` has been counting files here since it was written, printing `cas/manifests=0`
 * on every run, and its `cas-dedup-rate` measure REFUSED because a dedup rate is
 * `distinct blobs ÷ manifest references` and the denominator had never been produced by anything.
 *
 * WHY A MANIFEST AND NOT A COUNTER. `verifyAndStore` already returns `deduplicated: boolean`, so a
 * running total could have been carried in the run report — one number, no new directory. That was
 * rejected: a count answers "how many hits" and cannot answer "against what", so a reader could not
 * tell a genuine 90% reuse rate from a resolver that requested the same blob nine times. A manifest
 * records WHICH digests a run referenced, so the denominator is a set of references that can be
 * re-derived from disk and cross-checked against `cas/blobs` — the same reason the run report ships
 * denominators beside numerators instead of rates. ADR 0093 §4.
 *
 * Flat, like `reports` and `work`, and unlike the two-character fan-out of `cas/blobs`: manifests are
 * keyed by run, and a run count stays small enough that a listing is cheap. Callers must not assume a
 * shared traversal shape across these roots — `gate-s1.ts:428` records that assuming one is what made
 * its first blob census count 42 shards for 45 blobs.
 */
export function casManifestsRoot(root: string): string {
  return resolve(root, "cas", "manifests")
}

/**
 * The path of one run's CAS manifest, `cas/manifests/run-<id>.json`.
 *
 * The run id is validated because it becomes a path segment, for the same reason `casBlobPath`
 * validates its hex and `runReportPath` validates its id. Run ids are internal (`beginCompilerRun`
 * mints them), so a malformed one is a programming error rather than bad input, and this throws
 * instead of returning a refusal.
 *
 * Deliberately the SAME `run-<id>.json` naming as `runReportPath`, so the two projections of one run
 * join on their filename without a reader parsing either file. That join is why both now go through
 * the SAME `runIdSegment` encoder rather than each carrying its own copy of the rule — see its
 * docblock, which records why the duplication argued for here was the wrong trade.
 */
export function casManifestPath(root: string, runId: string): string {
  return resolve(casManifestsRoot(root), `run-${runIdSegment(runId, "casManifestPath")}.json`)
}

/**
 * True when `candidate` is inside `root`. Used by the INV-R7 assertion, and written
 * with `resolve` on both sides so a `..` segment cannot smuggle a path past a plain
 * `startsWith` on unnormalized text.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const r = resolve(root)
  const c = resolve(candidate)
  if (c === r) return true
  // Compare on a separator boundary: `/a/bc` must not count as inside `/a/b`.
  return c.startsWith(r.endsWith("\\") || r.endsWith("/") ? r : r + pathSep(r))
}

function pathSep(sample: string): string {
  return sample.includes("\\") ? "\\" : "/"
}
