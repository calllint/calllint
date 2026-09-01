#!/usr/bin/env tsx
/**
 * Gate S1 — the 100-record scale slice (new15 Execution Plan §27 "Gate S1 — 100 records").
 *
 * S1 sits one rung above Gate S0 on the expansion ladder S0(25) → S1(100) → S2(500) → S3(all) →
 * S4(second source). S0 asks "is the vertical slice correct?"; S1 asks "did correctness SURVIVE
 * scaling?" — the same subjects, four times as many of them.
 *
 * WHY THIS FILE IS BEING WRITTEN AFTER THE COHORT ALREADY PASSED 100. It is not being written to
 * unlock the expansion. The expansion already happened: the committed cohort is 150 (the ADR 0086
 * auto-growth curve, `DEFAULT_MAX_ENTRIES = 100` + one +50 step), and `S0_REGRESSION_FLOOR` in
 * `gate-s0.ts` already reads 150 to match it. So the 100-record threshold was crossed with **no gate
 * present to measure it**, and nothing redded — because there was nothing to red. That is this
 * repository's dominant fault class (a guard that cannot observe its subject) in its purest form:
 * not a guard blind to its subject, but a threshold with no guard at all.
 *
 * The only tracked record of S1's existence before this file was two lines of spec prose in
 * `docs/new15ref/…Execution_Plan_v1.0.md:1908` and its blueprint twin — and `docs/` is gitignored
 * (`.gitignore:44`), so S1's status lived on exactly one machine, which is the same defect
 * `artifacts/gate-s0/open-items.md` was written to fix for S0. A gate whose status no second clone
 * can read is a gate that cannot be handed over.
 *
 * WHAT THIS HARNESS REFUSES TO DO, and it is the whole design. The plan lists SEVEN measures:
 *
 *     source completeness · artifact resolution rate · adapter failure rate ·
 *     mean/p95 processing time · CAS dedup rate · disk growth · page quality
 *
 * Three of them are computable from committed bytes. Four of them are properties of a COMPILER RUN,
 * and the two queue tables those measures need — `compiler_jobs`, `compiler_runs` — are empty
 * everywhere, because `enqueueJobs` / `beginCompilerRun` have NO non-test caller in the repository:
 * the queue is a library with no driver. Computing "adapter failure rate" over zero attempts yields
 * `0 failures / 0 attempts`, which renders as a perfect score.
 *
 * ~~and the compiler's local store is empty: `.var/calllint-adoption-index/db/adoption-index.sqlite`
 * holds 0 rows in all ten data tables (only `schema_migrations` has 2), and `cas/blobs`, `cas/
 * manifests` and `dead-letter/` are empty directories.~~ **STRUCK 2026-08-28, AND THE REASON MATTERS
 * MORE THAN THE CORRECTION.** That sentence was false when it was written. It described the store at
 * the REPO ROOT, while the ingest worker — run through `pnpm --filter`, whose `cwd` is the package
 * directory — writes `packages/trust-index/.var/`, which held a 2551808-byte database with 298
 * canonical subjects, 1200 source records, 78 artifact versions and 45 CAS blobs dated three weeks
 * before this file existed. The refusals were right; their stated reason was not. A guard that reports
 * truthfully about the wrong directory is this repo's dominant fault class, and this file shipped it
 * while its own docblock was busy naming that fault class. Left struck rather than deleted for the
 * reason `gate-s0.ts` states about its own expired prose: a silently corrected claim teaches nobody
 * which assumption failed. See `storeCandidates` for the seam and S1-OPEN-4 for what is still owed.
 *
 * That exact defect has already been shipped in this repo once and caught: `gate-s0.ts`'s first
 * INV-R4 read a sidecar path that does not exist, so `existsSync` was false 39/39, the loop
 * `continue`d every iteration, and "0 dangerous false-SAFE" was printed as a PASS **from zero
 * observations**. A rate with an empty denominator is not a good result; it is the absence of a
 * measurement wearing a good result's clothes.
 *
 * So the four runtime measures are `REFUSED`, not zero. A refusal:
 *   - prints `✗`, never `✓`, and says which store was empty and what would populate it;
 *   - makes `--gate` exit 2, so the full S1 claim CANNOT be reported as passing today;
 *   - is not counted as a failed measurement in `--regression`, whose subject is the three measures
 *     that DO have a source. The two modes are separated for the same reason S0 separates them: one
 *     enforces the whole claim (red today, correctly), the other enforces what is true today so it
 *     can be wired into CI without pinning it red.
 *
 * This mirrors `gate-s0.ts`'s tiering vocabulary deliberately — MEASURED / EXECUTED / SCANNED /
 * REFUSED — because a second gate that invents a second vocabulary for the same distinction makes
 * the two unreadable side by side.
 *
 * Modes:
 *   (default) report — print every measure and the census. Exit 0 even when measures are REFUSED,
 *                      because reporting an absent data source IS a successful measurement.
 *   --gate           — ENFORCEMENT of the full S1 claim: all seven measures. Exit 2 if any measure
 *                      fails OR is REFUSED OR the cohort is under 100. Red on `main` today, and the
 *                      reason is the four absent runtime sources, NOT the cohort.
 *   --regression     — ENFORCEMENT of the three measures with a committed data source, plus a
 *                      monotonic cohort floor. Green today; reds when a measure regresses or the
 *                      cohort shrinks. This is the mode CI runs.
 *
 * `--gate --regression` is refused rather than resolved by precedence, exactly as in S0: they
 * enforce different claims, and picking one silently would let a caller believe the other ran.
 *
 * NOTHING HERE OPENS A SOCKET. Every number is read from committed bytes or from the local compiler
 * store; a network fetch would make the gate's verdict depend on upstream's mood (INV-M4).
 *
 * Exit codes: 0 ok · 2 gate failed (--gate / --regression) / unexpected error.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// The SHIPPED slugifier, imported rather than re-derived. `registryCanonicalName` is how a registry
// name (reverse-DNS with a slash) becomes the served page's key, and a local re-implementation would
// let the gate agree with its own copy while disagreeing with the bake — the failure Workstream R
// measured as "join on the SLUG: raw 0/19, slug 19/19".
import {
  parseSnapshot,
  registryCanonicalName,
  synthesizeConfigText,
  REGISTRY_NAMESPACE,
} from "../packages/trust-index/src/snapshot.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const rel = (p: string): string => path.relative(repoRoot, p).replace(/\\/g, "/")

/**
 * The record floor S1 names — a REQUIREMENT, not a cap. 100 is the plan's own number
 * (`§27 Gate S1 — 100 records`). Stated so a short cohort reads as a shortfall rather than being
 * silently rescaled to whatever happens to be committed.
 */
const S1_REQUIRED_RECORDS = 100

/**
 * The ratchet floor for `--regression`: the registry cohort must not shrink below this.
 *
 * DERIVED, never written down — the same discipline ADR 0083 imposed on S0's floor, and for the same
 * reason: a hardcoded floor is a number someone edits downward to make a red CI green. This reads
 * the committed snapshot, so the floor IS the achievement and cannot lead it.
 *
 * S0 keeps a literal (`S0_REGRESSION_FLOOR = 150`) pinned by a test. S1 derives instead, which is
 * strictly stronger for this gate and NOT a criticism of S0's choice: S0's literal is what lets a
 * test catch a cohort DROP between two commits, because the literal is the previous commit's
 * cohort. S1's floor answers a different question — "did the served tree keep up with the source?" —
 * so it wants today's source count, not yesterday's.
 */
function committedRegistryCohort(): number | null {
  const p = path.join(repoRoot, "packages/trust-index/snapshots/official-mcp-registry.json")
  if (!existsSync(p)) return null
  try {
    const snap = JSON.parse(readFileSync(p, "utf8")) as { entries?: readonly unknown[] }
    return Array.isArray(snap.entries) ? snap.entries.length : null
  } catch {
    return null
  }
}

//---------------------------------------------------------------------------------------------------
// Modes
//---------------------------------------------------------------------------------------------------
const isGate = process.argv.includes("--gate")
const isRegression = process.argv.includes("--regression")

if (isGate && isRegression) {
  console.error(
    `❌ --gate and --regression are mutually exclusive: they enforce different claims.\n` +
      `   --gate       = the full S1 claim (all seven measures + the 100-record requirement)\n` +
      `   --regression = the three measures with a committed data source + the cohort floor`,
  )
  process.exit(2)
}

//---------------------------------------------------------------------------------------------------
// Inputs
//---------------------------------------------------------------------------------------------------
const snapshotPath = path.join(repoRoot, "packages/trust-index/snapshots/official-mcp-registry.json")
const indexPath = path.join(repoRoot, "apps/web/public/trust/index.json")
const pagesDir = path.join(repoRoot, "apps/web/public/trust", REGISTRY_NAMESPACE)

/**
 * Every directory a store can land in — because `.var/` LOCATION IS DECIDED BY `cwd`, AND THE WORKER'S
 * `cwd` IS NOT THE REPO ROOT.
 *
 * `resolveIndexPaths(cwd)` (`packages/adoption-index/src/storage/paths.ts:50`) resolves
 * `.var/calllint-adoption-index` relative to whatever `cwd` it is handed, and the ingest step reads
 * `process.cwd()` (`packages/trust-index/src/refreshSnapshot.ts:367`). Under
 * `pnpm --filter @calllint/trust-index …` — which is exactly how `pnpm ingest:trust-index` and
 * `pnpm project-adoption-index:trust-index:store` invoke it — `cwd` is the PACKAGE directory. Under
 * the systemd unit it is `WorkingDirectory=/opt/calllint`. So one seam yields two different stores
 * depending on how the worker was started.
 *
 * THIS GATE'S FIRST VERSION READ ONLY THE REPO ROOT, AND WAS WRONG ABOUT ITS SUBJECT. It printed
 * `cas/blobs=0, db=131072B` and the sentence "the rolling compiler has not run against this
 * checkout" while `packages/trust-index/.var/` held a 2551808-byte database with 298
 * `canonical_subjects`, 1200 `source_records`, 839 `subject_aliases`, 78 `artifact_versions` and 45
 * CAS blobs whose mtimes (2026-08-04) predate this gate by three weeks. The refusals were right and
 * their stated reason was false — a guard reporting truthfully about the wrong directory.
 *
 * `paths.ts:115` had already recorded this exact failure for a mis-rooted CAS sweep: it "would simply
 * sweep a directory nothing writes to and report `inspected 0` forever". That warning was in the tree
 * before this gate was written, aimed at a sweep, and this gate reproduced it anyway.
 *
 * So the location is DISCOVERED rather than assumed, and every candidate is reported. A single
 * hardcoded path — even the correct one — would just move the blind spot to whichever store the next
 * invocation style creates. `ADOPTION_INDEX_CWD` is honoured because `pruneCas.ts:59` and
 * `backupAdoptionIndex.ts:52` already treat it as the store's override seam; this gate must not
 * invent a second convention.
 *
 * IT IS AN EXCLUSIVE OVERRIDE, NOT A PREFERRED CANDIDATE (fixed 2026-09-01, ADR 0096). Until now this
 * PREPENDED the override and still searched both default roots, then picked the newest report across
 * all of them. That is not the cited convention: `pruneCas.ts:59` reads `env || process.cwd()`, sweeps
 * ONE directory, and cannot be redirected by a second store existing elsewhere. Prepending inverted
 * the seam's purpose — a caller naming a store got the *other* store whenever the other store's report
 * was newer, which is exactly the mis-rooted read this docblock was written about, one level up.
 *
 * This was unobservable until 2026-09-01. Every `reports/` on every machine was empty, because both
 * artifact writers refused every write for the whole life of the project (ADR 0094). Two invariant
 * tests asserted isolation through this seam and passed; they passed because there was nothing to
 * leak, not because the seam held. Writing the project's first run report redded both.
 */
const STORE_DIRNAME = ".var/calllint-adoption-index"
const overrideCwd = (process.env.ADOPTION_INDEX_CWD ?? "").trim()
const storeCandidates: readonly string[] = overrideCwd
  ? [path.join(overrideCwd, STORE_DIRNAME)]
  : [path.join(repoRoot, STORE_DIRNAME), path.join(repoRoot, "packages/trust-index", STORE_DIRNAME)]

interface ServedEntry {
  readonly canonicalName: string
  readonly status: string
  readonly verdict: string | null
  readonly artifactDigest?: string
  readonly pageDigest?: string
}

/**
 * A measure's outcome. `refused` is a first-class outcome, not a `false` with a nicer message: the
 * exit-code logic below treats "the source is absent" differently from "the source disagrees",
 * because the remedies differ (populate a store vs. fix a bake).
 */
type Outcome =
  | { readonly kind: "measured"; readonly ok: boolean; readonly message: string }
  | { readonly kind: "refused"; readonly message: string }

interface Measure {
  readonly id: string
  readonly tier: "MEASURED" | "REFUSED"
  readonly outcome: Outcome
}

const measures: Measure[] = []

function measured(id: string, ok: boolean, message: string): void {
  measures.push({ id, tier: "MEASURED", outcome: { kind: "measured", ok, message } })
}

function refused(id: string, message: string): void {
  measures.push({ id, tier: "REFUSED", outcome: { kind: "refused", message } })
}

//---------------------------------------------------------------------------------------------------
// Census
//---------------------------------------------------------------------------------------------------
let snapshotEntries: ReturnType<typeof parseSnapshot>["entries"] | null = null
let snapshotError: string | null = null
try {
  snapshotEntries = parseSnapshot(readFileSync(snapshotPath, "utf8")).entries
} catch (err) {
  snapshotError = err instanceof Error ? err.message : String(err)
}

let served: readonly ServedEntry[] | null = null
let servedError: string | null = null
try {
  const doc = JSON.parse(readFileSync(indexPath, "utf8")) as { entries?: readonly ServedEntry[] }
  served = Array.isArray(doc.entries) ? doc.entries : null
  if (served === null) servedError = `${rel(indexPath)} has no \`entries\` array`
} catch (err) {
  servedError = err instanceof Error ? err.message : String(err)
}

const censusSource = snapshotEntries?.length ?? 0
const servedRegistry = (served ?? []).filter((e) => e.canonicalName.startsWith(`${REGISTRY_NAMESPACE}/`))
const censusServed = servedRegistry.length
const ratchetFloor = committedRegistryCohort()

//---------------------------------------------------------------------------------------------------
// Measure 1 — SOURCE COMPLETENESS (MEASURED): every source record reached the served tree.
//
// Keyed through the shipped `registryCanonicalName`, so a change to the slug rule moves this
// measure's join in lockstep with the bake's. A miss here means a record was fetched and then
// silently dropped — INV-R5's concern, at scale.
//---------------------------------------------------------------------------------------------------
if (snapshotEntries === null || served === null) {
  refused(
    "source-completeness",
    `input unreadable — ${snapshotError ?? servedError ?? "unknown"}`,
  )
} else {
  const servedNames = new Set(servedRegistry.map((e) => e.canonicalName))
  const absent: string[] = []
  for (const e of snapshotEntries) {
    if (!servedNames.has(registryCanonicalName(e.name))) absent.push(e.name)
  }
  measured(
    "source-completeness",
    absent.length === 0,
    absent.length === 0
      ? `${censusSource}/${censusSource} source records reached the served tree`
      : `${absent.length} source record(s) absent from the served tree: ${absent.slice(0, 5).join(", ")}${absent.length > 5 ? ` (+${absent.length - 5} more)` : ""}`,
  )
}

//---------------------------------------------------------------------------------------------------
// Measure 2 — ARTIFACT RESOLUTION RATE (MEASURED): a source record either yields a scannable
// artifact or is recorded `incomplete`.
//
// The rate is not asserted against a threshold, because a registry entry declaring neither a package
// nor a remote is a fact about upstream, not a defect here. What IS asserted is the AGREEMENT of two
// independent readings: `synthesizeConfigText(e) === null` (the source-side reason a record cannot be
// scanned) must select exactly the set the served index marks `incomplete`. A disagreement means one
// side is wrong about which subjects are judgeable, which is how a false SAFE gets in.
//---------------------------------------------------------------------------------------------------
if (snapshotEntries === null || served === null) {
  refused("artifact-resolution", `input unreadable — ${snapshotError ?? servedError ?? "unknown"}`)
} else {
  const unresolvableSource = new Set(
    snapshotEntries.filter((e) => synthesizeConfigText(e) === null).map((e) => registryCanonicalName(e.name)),
  )
  const incompleteServed = new Set(
    servedRegistry.filter((e) => e.status !== "baked").map((e) => e.canonicalName),
  )
  const onlySource = [...unresolvableSource].filter((n) => !incompleteServed.has(n))
  const onlyServed = [...incompleteServed].filter((n) => !unresolvableSource.has(n))
  const resolvable = censusSource - unresolvableSource.size
  const agree = onlySource.length === 0 && onlyServed.length === 0
  measured(
    "artifact-resolution",
    agree,
    agree
      ? `${resolvable}/${censusSource} resolvable; the ${unresolvableSource.size} unresolvable source record(s) are exactly the ${incompleteServed.size} the index marks incomplete`
      : `source and served disagree on which records are judgeable — unresolvable-but-baked: ${onlySource.join(", ") || "none"}; incomplete-but-resolvable: ${onlyServed.join(", ") || "none"}`,
  )
}

//---------------------------------------------------------------------------------------------------
// Measure 3 — PAGE QUALITY (MEASURED): every baked subject has its full served trio, and the page's
// own digests agree with the index's.
//
// "Quality" is deliberately read as COMPLETENESS AND SELF-AGREEMENT rather than as a rendering
// judgement. A rendering score would need a threshold nobody has set; a missing sidecar or a page
// whose digest disagrees with the index is unambiguously broken, and at 150 subjects it is the fault
// that scaling actually produces.
//---------------------------------------------------------------------------------------------------
if (served === null) {
  refused("page-quality", `input unreadable — ${servedError ?? "unknown"}`)
} else if (!existsSync(pagesDir)) {
  refused("page-quality", `served pages directory absent: ${rel(pagesDir)}`)
} else {
  const baked = servedRegistry.filter((e) => e.status === "baked")
  const broken: string[] = []
  for (const e of baked) {
    const slug = e.canonicalName.slice(`${REGISTRY_NAMESPACE}/`.length)
    const missing = [".html", ".json", ".manifest.json"].filter(
      (ext) => !existsSync(path.join(pagesDir, `${slug}${ext}`)),
    )
    if (missing.length > 0) {
      broken.push(`${slug} (missing ${missing.join(" ")})`)
      continue
    }
    // The page's own bytes must agree with the index about what it is. A page carrying a different
    // artifactDigest than the index advertises is a stale bake the index cannot see.
    try {
      const page = JSON.parse(readFileSync(path.join(pagesDir, `${slug}.json`), "utf8")) as {
        artifactDigest?: string
        pageDigest?: string
      }
      if (e.artifactDigest !== undefined && page.artifactDigest !== e.artifactDigest) {
        broken.push(`${slug} (artifactDigest disagrees with index)`)
      } else if (e.pageDigest !== undefined && page.pageDigest !== e.pageDigest) {
        broken.push(`${slug} (pageDigest disagrees with index)`)
      }
    } catch (err) {
      broken.push(`${slug} (sidecar unreadable: ${err instanceof Error ? err.message : String(err)})`)
    }
  }
  measured(
    "page-quality",
    broken.length === 0,
    broken.length === 0
      ? `${baked.length}/${baked.length} baked subjects carry html+json+manifest and agree with the index on both digests`
      : `${broken.length} defective page(s): ${broken.slice(0, 5).join("; ")}${broken.length > 5 ? ` (+${broken.length - 5} more)` : ""}`,
  )
}

//---------------------------------------------------------------------------------------------------
// Measures 4–7 — the runtime measures. THREE ARE STILL REFUSED; ONE NOW HAS A SOURCE.
//
// THE REFUSALS STAND; THE REASON THE FIRST VERSION GAVE DID NOT. It asserted "the rolling compiler has
// not run against this checkout" from a directory listing of the repo root alone. Measured: a store
// under `packages/trust-index/.var/` holds 298 canonical subjects, 1200 source records, 78 artifact
// versions and 45 CAS blobs. The compiler HAS run; the gate was looking somewhere else
// (see `storeCandidates`).
//
// THE SECOND VERSION'S SHARED REASON HAS ALSO NOW EXPIRED, and it is worth recording why, because the
// error was the same shape twice. All four refusals carried one hint — "no queue driver exists
// (S1-OPEN-1)" — which treated a single missing component as the sole blocker for four independent
// measures. That was half wrong. `compiler_jobs` is indeed empty, but the four compile stages
// (`syncSource`, `resolveIdentity`, `resolveArtifacts`, `compileEvidence`) are ALL wired and default-ON
// in `packages/trust-index/src/refreshSnapshot.ts` — the first two inside `refreshFromMirror`, the
// other two through its `artifactPort` / `evidencePort` seams. Attempts were happening on every ingest
// run. They were simply never RECORDED. So the blocker was never "no execution"; it was "no
// bookkeeping", and pinning it on a missing driver hid three genuinely different blockers behind one
// sentence.
//
// Each measure now states its OWN blocker, because they are not the same blocker:
//
//   - adapter-failure-rate: HAS A SOURCE NOW. `refreshSnapshot.ts` brackets the ingest in
//     `beginCompilerRun` / `concludeCompilerRun` and projects the result to
//     `reports/run-<id>.json`, carrying `considered` / `unavailable` / `rejected` /
//     `skippedNoAdapter` as separate counts. This gate reads that JSON rather than the database,
//     for the ABI reason below. Until a run has been executed against this checkout the file is
//     absent, and an absent report is REFUSED — never 0/0.
//   - processing-time-mean-p95: blocked on SCHEMA, not on a driver. `compiler_jobs`
//     (`migrations/001-canonical-adoption-graph.sql`) has `created_at` / `updated_at` /
//     `available_at` and NO `started_at` / `finished_at`. There is nowhere to record a duration.
//     Adding the columns breaks the 14-column ↔ 14-property equality `domain/job.ts:13` documents,
//     so it needs a migration and an ADR. It cannot be unblocked by running anything.
//   - cas-dedup-rate: was blocked on a MISSING WRITER, and a different one from the others.
//     `cas/manifests` was declared in `INDEX_SUBDIRS` with zero writers anywhere in the repo — no
//     `casManifestsRoot()` even as a path helper, unlike `casBlobsRoot()` / `casWorkRoot()` — so the
//     denominator had never been produced by anything and the measure was uncomputable by any run,
//     past or future. **CLOSED 2026-08-31 (ADR 0093):** `artifacts/casManifest.ts` writes
//     `cas/manifests/run-<id>.json` from the references `resolveArtifacts` already returns, and this
//     gate reads it below. The blocker is now the same one `adapter-failure-rate` has — no run has
//     executed against THIS checkout — which is closed by running an ingest rather than by building
//     anything. The refusal says which of those two states it is in.
//
//     Note what the fix did NOT do: it did not sum `verifyAndStore`'s `deduplicated` booleans into a
//     counter, which would have closed the measure with one integer and no new directory. A count
//     answers "how many hits" and cannot answer "against what", so nine requests for one blob and
//     nine distinct blobs sharing one prior both report "8 deduplicated" while meaning opposite
//     things. ADR 0093 §4.
//   - disk-growth: blocked on TIME. It needs two measurements separated by real runs. Today's
//     number is recorded below as the baseline; one measurement cannot be a growth rate.
//
// `artifact_versions.artifact_status` DOES carry a real distribution (measured: FETCHED 45 /
// RESOLVED 25 / UNAVAILABLE 8), which is adapter-shaped evidence. It is deliberately NOT reported as
// "adapter failure rate": that column grades an artifact's state, not an attempt's outcome, so a rate
// over it would answer a different question than §342 asks while wearing the name of the one it asks.
// The run report answers the question actually asked, because it counts ATTEMPTS. S1-OPEN-4 carries
// the distinction, and it stays open: the cheapest way to close this measure on paper is still to
// rename that column into it.
//
// Reading SQLite is still declined here, and now for a narrower reason than the first version gave:
// `better-sqlite3` is pinned to 12.9.0 for an ABI cliff, and a gate that cannot start on a mismatched
// Node is worse than one that reports less. That constraint is precisely why the run report is a JSON
// file: a projection with no ABI. The row in `compiler_runs` remains the record of truth; if the two
// ever disagree, the row wins and the report is the bug.
//---------------------------------------------------------------------------------------------------

/** One store's observable footprint, with the path that produced it so a number can never float free. */
interface StoreFootprint {
  readonly root: string
  readonly exists: boolean
  readonly casBlobs: number
  readonly casManifests: number
  readonly deadLetter: number
  readonly reports: number
  readonly dbBytes: number
}

/**
 * Count FILES beneath `p`, recursively — not top-level entries.
 *
 * The first version used `readdirSync(dir).length`, which for `cas/blobs` counts the two-character
 * fan-out SHARDS, not blobs: measured 42 shards for 45 blobs, an undercount that grows as shards
 * collide. `paths.ts:117-118` explicitly warns that the blob tree is a fan-out while `work/` is flat
 * and that "callers must not assume a shared traversal shape" — the first version assumed exactly
 * that. Recursing is correct for both shapes, so one function serves every directory here.
 */
function countFiles(p: string): number {
  if (!existsSync(p)) return 0
  let total = 0
  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(p, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const child = path.join(p, e.name)
    if (e.isDirectory()) total += countFiles(child)
    else total += 1
  }
  return total
}

function footprint(root: string): StoreFootprint {
  const dbFile = path.join(root, "db/adoption-index.sqlite")
  return {
    root,
    exists: existsSync(root),
    casBlobs: countFiles(path.join(root, "cas/blobs")),
    casManifests: countFiles(path.join(root, "cas/manifests")),
    deadLetter: countFiles(path.join(root, "dead-letter")),
    reports: countFiles(path.join(root, "reports")),
    dbBytes: existsSync(dbFile) ? statSync(dbFile).size : 0,
  }
}

const footprints = storeCandidates.map(footprint)
/** The candidate with the most bytes on disk — the one a reader would actually want reported. */
const primary = footprints.reduce((a, b) => (b.dbBytes > a.dbBytes ? b : a), footprints[0]!)
const casBlobsTotal = footprints.reduce((n, f) => n + f.casBlobs, 0)
const casManifestsTotal = footprints.reduce((n, f) => n + f.casManifests, 0)

/**
 * The store census, EVERY candidate listed — because naming only the winner would hide the very
 * divergence that made the first version wrong.
 *
 * Printed ONCE, below the measure list, rather than interpolated into each of the four refusals. The
 * first version repeated its hint verbatim four times; at two candidate stores that is eight paths of
 * identical text per run, and a refusal nobody finishes reading is a refusal that cannot instruct.
 */
const storeCensus =
  footprints
    .map((f) => `    ${rel(f.root)}: cas/blobs=${f.casBlobs}, cas/manifests=${f.casManifests}, dead-letter=${f.deadLetter}, reports=${f.reports}, db=${f.dbBytes}B${f.exists ? "" : " (absent)"}`)
    .join("\n")

/**
 * The newest run report across all candidate stores, plus a count of files that LOOKED like reports
 * and could not be read.
 *
 * Deliberately tolerant on the way in and strict on the way out. Any file that is missing, unreadable,
 * not JSON, of an unknown schema, or missing the `attempts.artifacts` section is skipped rather than
 * crashed on — a gate that dies on one malformed report tells the reader nothing about the other six
 * measures. But a skipped report is NOT downgraded to zeros: no report means REFUSED, and the whole
 * point of this function is that "no report" and "a report saying zero" stay distinguishable.
 *
 * `rejected` is returned rather than discarded because the two refusals read identically to a human
 * and demand opposite actions. A missing report means "run an ingest"; a present-but-unreadable one
 * means "an ingest ran and wrote something this gate cannot interpret" — most likely a schema bump —
 * and telling that reader to run another ingest would send them to repeat an act that already
 * happened. An earlier version of this function collapsed both into "no run report exists yet", which
 * is a refusal that misdirects: the same defect class as a wrong measurement, just wearing a refusal's
 * clothes.
 *
 * "Newest" is by `completedAt` string compare, which is correct for the ISO-8601-Z timestamps the
 * writer emits and requires no clock read here.
 */
function newestRunReport(): {
  best: { report: RunReportShape; path: string } | null
  rejected: string[]
} {
  let best: { report: RunReportShape; path: string } | null = null
  const rejected: string[] = []
  for (const f of footprints) {
    const dir = path.join(f.root, "reports")
    let entries: string[]
    try {
      entries = readdirSync(dir).filter((e) => e.startsWith("run-") && e.endsWith(".json"))
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e)
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(p, "utf8"))
      } catch {
        rejected.push(`${rel(p)} (not parseable as JSON)`)
        continue
      }
      const checked = checkRunReport(parsed)
      if (!checked.ok) {
        rejected.push(`${rel(p)} (${checked.reason})`)
        continue
      }
      const report = checked.report
      if (best === null || report.completedAt > best.report.completedAt) best = { report, path: p }
    }
  }
  return { best, rejected }
}

/**
 * The schema ids this gate can read, ENUMERATED — written once, and matched exactly.
 *
 * Each id appears in the shape check and in every refusal reason that check produces. Two copies of a
 * schema id is how a gate comes to reject a file for not being a version it is in fact looking at.
 *
 * **Why a set and not a prefix test.** `calllint.compiler-run-report.` + `startsWith` would accept every
 * future version sight unseen, including one that renamed `attempts.artifacts.unavailable` — and this
 * gate divides by those counters. A prefix match is how a schema version stops being a guarantee: the
 * only thing a version number buys you is the right to refuse a shape you have not read. So membership
 * is exact, per version, and a version absent from this list refuses while NAMING the version it found.
 *
 * **Why v1 is still here after the v2 bump.** v2 added a `source` section and changed nothing this gate
 * reads (`attempts.artifacts` is byte-identical). Dropping v1 would make every report written before
 * 2026-08-31 unreadable — a gate that refuses the entire history to signal that a newer writer exists.
 * v1 reports remain valid readings of the four counters they contain; they simply cannot answer the
 * source-coverage question, which is Gate S2's, not this gate's.
 */
const READABLE_SCHEMAS = ["calllint.compiler-run-report.v1", "calllint.compiler-run-report.v2"] as const

/** The set rendered for a refusal message, so the reader sees what WOULD have been accepted. */
const READABLE_SCHEMAS_LIST = READABLE_SCHEMAS.map((s) => `\`${s}\``).join(" or ")

function isReadableSchema(v: unknown): v is (typeof READABLE_SCHEMAS)[number] {
  return typeof v === "string" && (READABLE_SCHEMAS as readonly string[]).includes(v)
}

/** Only the fields this gate reads. A narrower shape than the writer's, on purpose. */
interface RunReportShape {
  readonly schema: string
  readonly runId: string
  readonly outcome: string
  readonly completedAt: string
  readonly attempts: {
    readonly artifacts: {
      readonly considered: number
      readonly fetched: number
      readonly unavailable: number
      readonly rejected: number
      readonly skippedNoAdapter: number
      readonly cached: number
    } | null
  }
}

/**
 * Validate the shape before trusting a number out of it, and return WHY when it refuses.
 *
 * The schema id is checked against an enumerated set, exactly, never by prefix: a `.v3` that renamed a
 * counter would otherwise be read with v2 semantics and produce a confident wrong rate. An unknown
 * version must refuse, which is the same rule the product applies to its own inputs — UNKNOWN is not
 * SAFE. v2 is in the set because it added a section this gate does not read and changed nothing it does.
 *
 * It returns a REASON rather than a boolean because the caller cannot reconstruct one. The first
 * version was a type guard, and its caller had to re-derive the cause from the outside; the only thing
 * it could still see was `schema`, so it printed both candidate causes joined by "or". On a report whose
 * schema was right and whose FIELDS had drifted that rendered as
 *
 *     schema `calllint.compiler-run-report.v1`, not `calllint.compiler-run-report.v1`, or missing
 *     required fields
 *
 * — a sentence that denies its own first clause. The refusal was correct; its reason misdirected, which
 * is the defect class the `newestRunReport` docblock above already describes for "no report" vs
 * "unreadable report", reappearing one level down. A message assembled by a second reader of the same
 * value drifts from what the check actually rejected; a message produced BY the check cannot.
 *
 * So each `return` below carries the specific clause for the branch it is in, and the field-drift branch
 * names the offending key. `checkRunReport` is the only place that decides both.
 */
type RunReportCheck = { ok: true; report: RunReportShape } | { ok: false; reason: string }

function checkRunReport(v: unknown): RunReportCheck {
  if (typeof v !== "object" || v === null) return { ok: false, reason: "not a JSON object" }
  const r = v as Record<string, unknown>
  if (!isReadableSchema(r.schema)) {
    return {
      ok: false,
      // The " or " in `READABLE_SCHEMAS_LIST` enumerates the ACCEPTED SET, and is not the
      // or-of-two-candidate-causes this function's docblock describes. The cause here is singular and
      // known — the id is not in the readable set — and the disjunction is the answer to "what would
      // you have taken?", which a reader fixing a version mismatch needs.
      reason:
        typeof r.schema === "string"
          ? `schema \`${r.schema}\`, not ${READABLE_SCHEMAS_LIST}`
          : "no readable `schema` field",
    }
  }
  // Past this point the version is known-readable, so every reason below names the version IN THE FILE
  // rather than a constant. On a v2 report with a drifted counter the message says v2 — which is the
  // version whose contract was broken, and the one a reader must go and compare against the writer.
  const found = r.schema
  for (const k of ["runId", "outcome", "completedAt"] as const) {
    if (typeof r[k] !== "string") {
      return { ok: false, reason: `schema \`${found}\` but \`${k}\` is missing or not a string` }
    }
  }
  const attempts = r.attempts
  if (typeof attempts !== "object" || attempts === null) {
    return { ok: false, reason: `schema \`${found}\` but \`attempts\` is missing or not an object` }
  }
  const artifacts = (attempts as Record<string, unknown>).artifacts
  // `null` is a MEANINGFUL value here, not an absence: it is how the writer records a run that ran with
  // artifact resolution disabled. Accepting it is what lets the caller refuse with "stage DISABLED"
  // instead of lumping a deliberate skip in with a malformed file.
  if (artifacts === null) return { ok: true, report: v as RunReportShape }
  if (typeof artifacts !== "object") {
    return { ok: false, reason: `schema \`${found}\` but \`attempts.artifacts\` is neither an object nor null` }
  }
  const a = artifacts as Record<string, unknown>
  for (const k of ["considered", "fetched", "unavailable", "rejected", "skippedNoAdapter", "cached"] as const) {
    if (!Number.isInteger(a[k]) || (a[k] as number) < 0) {
      return {
        ok: false,
        reason:
          `schema \`${found}\` but \`attempts.artifacts.${k}\` is ` +
          `${a[k] === undefined ? "missing" : `${JSON.stringify(a[k])}, not a non-negative integer`}`,
      }
    }
  }
  return { ok: true, report: v as RunReportShape }
}

const { best: runReport, rejected: rejectedReports } = newestRunReport()

//---------------------------------------------------------------------------------------------------
// CAS manifests — the denominator `cas-dedup-rate` never had
//---------------------------------------------------------------------------------------------------

/**
 * The schema ids this gate can read for a CAS manifest. Exact membership, never a prefix — the same
 * rule and the same reason as `READABLE_SCHEMAS` above: a prefix accepts every future version sight
 * unseen, and this gate divides by the counts inside.
 */
const READABLE_MANIFEST_SCHEMAS = ["calllint.cas-manifest.v1"] as const
const READABLE_MANIFEST_SCHEMAS_LIST = READABLE_MANIFEST_SCHEMAS.map((s) => `\`${s}\``).join(" or ")

/** Only the fields this gate reads. Narrower than the writer's shape, on purpose. */
interface CasManifestShape {
  readonly schema: string
  readonly runId: string
  readonly completedAt: string
  readonly references: readonly { readonly digest: string; readonly deduplicated: boolean }[]
  readonly totals: {
    readonly references: number
    readonly distinctDigests: number
    readonly deduplicated: number
  }
}

type CasManifestCheck = { ok: true; manifest: CasManifestShape } | { ok: false; reason: string }

/**
 * Validate a manifest and RE-DERIVE its totals from its own list.
 *
 * The re-derivation is the point, not a formality. A manifest ships both the references and the counts
 * over them, and a reader that trusted `totals` would be trusting the one number a buggy writer would
 * get wrong — while the evidence to check it sits in the same file. So the counts are recomputed here
 * and a disagreement is a REFUSAL naming both sides, which is the only way a projection can be caught
 * lying about itself. This is `summarizeReferences`'s logic restated in a script that cannot import the
 * package (`gate-s1.ts` links nothing, for the ABI reason the run-report docblock gives), and the
 * duplication is deliberate: an independent recount is worth nothing if it calls the same function.
 *
 * Returns a REASON rather than a boolean for the reason `checkRunReport` records at length — a message
 * assembled by a second reader of the value drifts from what the check rejected.
 */
function checkCasManifest(v: unknown): CasManifestCheck {
  if (typeof v !== "object" || v === null) return { ok: false, reason: "not a JSON object" }
  const r = v as Record<string, unknown>
  if (typeof r.schema !== "string" || !(READABLE_MANIFEST_SCHEMAS as readonly string[]).includes(r.schema)) {
    return {
      ok: false,
      reason:
        typeof r.schema === "string"
          ? `schema \`${r.schema}\`, not ${READABLE_MANIFEST_SCHEMAS_LIST}`
          : "no readable `schema` field",
    }
  }
  const found = r.schema
  for (const k of ["runId", "completedAt"] as const) {
    if (typeof r[k] !== "string") {
      return { ok: false, reason: `schema \`${found}\` but \`${k}\` is missing or not a string` }
    }
  }
  if (!Array.isArray(r.references)) {
    return { ok: false, reason: `schema \`${found}\` but \`references\` is missing or not an array` }
  }
  const digests = new Set<string>()
  let dedup = 0
  for (const [i, raw] of r.references.entries()) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, reason: `schema \`${found}\` but \`references[${i}]\` is not an object` }
    }
    const ref = raw as Record<string, unknown>
    if (typeof ref.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(ref.digest)) {
      return {
        ok: false,
        reason:
          `schema \`${found}\` but \`references[${i}].digest\` is ` +
          `${ref.digest === undefined ? "missing" : `${JSON.stringify(ref.digest)}, not a \`sha256:<64 hex>\` digest`}`,
      }
    }
    if (typeof ref.deduplicated !== "boolean") {
      return { ok: false, reason: `schema \`${found}\` but \`references[${i}].deduplicated\` is not a boolean` }
    }
    digests.add(ref.digest)
    if (ref.deduplicated) dedup += 1
  }
  const totals = r.totals
  if (typeof totals !== "object" || totals === null) {
    return { ok: false, reason: `schema \`${found}\` but \`totals\` is missing or not an object` }
  }
  const t = totals as Record<string, unknown>
  for (const k of ["references", "distinctDigests", "deduplicated"] as const) {
    if (!Number.isInteger(t[k]) || (t[k] as number) < 0) {
      return {
        ok: false,
        reason:
          `schema \`${found}\` but \`totals.${k}\` is ` +
          `${t[k] === undefined ? "missing" : `${JSON.stringify(t[k])}, not a non-negative integer`}`,
      }
    }
  }
  // The recount. A manifest that disagrees with itself is refused, naming both sides — never quietly
  // preferred one way, because which side is right is exactly what a reader here cannot know.
  const derived = { references: r.references.length, distinctDigests: digests.size, deduplicated: dedup }
  for (const k of ["references", "distinctDigests", "deduplicated"] as const) {
    if (t[k] !== derived[k]) {
      return {
        ok: false,
        reason:
          `schema \`${found}\` but \`totals.${k}\` states ${String(t[k])} while its own \`references\` ` +
          `list yields ${derived[k]} — the projection disagrees with itself`,
      }
    }
  }
  return { ok: true, manifest: v as CasManifestShape }
}

/**
 * The newest CAS manifest across all candidate stores, plus the ones that could not be read.
 *
 * Same tolerant-in / strict-out contract as `newestRunReport`, and the `rejected` list is returned for
 * the same reason: "no manifest" and "a manifest this gate cannot read" demand opposite actions from a
 * human, and collapsing them is a refusal that misdirects.
 */
function newestCasManifest(): {
  best: { manifest: CasManifestShape; path: string } | null
  rejected: string[]
} {
  let best: { manifest: CasManifestShape; path: string } | null = null
  const rejected: string[] = []
  for (const f of footprints) {
    const dir = path.join(f.root, "cas/manifests")
    let entries: string[]
    try {
      entries = readdirSync(dir).filter((e) => e.startsWith("run-") && e.endsWith(".json"))
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e)
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(p, "utf8"))
      } catch {
        rejected.push(`${rel(p)} (not parseable as JSON)`)
        continue
      }
      const checked = checkCasManifest(parsed)
      if (!checked.ok) {
        rejected.push(`${rel(p)} (${checked.reason})`)
        continue
      }
      const m = checked.manifest
      if (best === null || m.completedAt > best.manifest.completedAt) best = { manifest: m, path: p }
    }
  }
  return { best, rejected }
}

const { best: casManifest, rejected: rejectedManifests } = newestCasManifest()

/**
 * Measure 4 — adapter failure rate. The one measure this batch gave a source.
 *
 * The rate is `(unavailable + rejected) / (unavailable + rejected + fetched + cached)`: attempts that
 * were TRIED and failed, over attempts that were tried at all. `skippedNoAdapter` is excluded from
 * both halves — `resolveArtifacts.ts:33` is explicit that not-tried is not tried-and-failed, and
 * folding it into the denominator would silently dilute the rate toward zero on a cohort where most
 * subjects have no adapter, which is exactly today's cohort. It is printed alongside so the reader can
 * see how much of `considered` was never attempted.
 *
 * The zero-denominator branch REFUSES instead of reporting 0%. That is the whole lesson of
 * `gate-s0.ts`'s first INV-R4, which printed "0 dangerous false-SAFE" as a PASS from 39 reads of a
 * path that did not exist. A rate over zero attempts is not a good result; it is no result.
 */
if (runReport === null && rejectedReports.length > 0) {
  // A report EXISTS and this gate cannot read it. Do not tell the reader to run an ingest — one ran.
  //
  // The generic half of this message used to assert a cause: "An unknown schema is REFUSED rather than
  // read with v1 semantics". That is true of a schema bump and FALSE of the field-drift case, where the
  // schema matched exactly and a counter had been renamed — so on that input the sentence contradicted
  // the per-file reason printed two clauses earlier. A wrapper that names a cause its own detail lines
  // may disagree with is the `newestRunReport` defect at one level up, so this one names the RULE
  // (refuse rather than guess) and leaves the cause to `checkRunReport`, which is the only thing that
  // knows it.
  refused(
    "adapter-failure-rate",
    `${rejectedReports.length} run report file(s) exist but NONE is readable by this gate, so no rate ` +
      `can be computed and none is guessed: ${rejectedReports.join("; ")}. A report this gate cannot ` +
      `validate is REFUSED rather than read with a version's semantics it does not claim — a renamed ` +
      `or missing counter would otherwise produce a confident wrong rate. Remedy: reconcile ` +
      `\`checkRunReport\` in this script ` +
      `with the writer in \`packages/adoption-index/src/storage/runReport.ts\` — do NOT re-run the ` +
      `ingest, one already ran`,
  )
} else if (runReport === null) {
  refused(
    "adapter-failure-rate",
    `no run report exists yet. \`refreshSnapshot.ts\` now brackets every ingest in ` +
      `\`beginCompilerRun\`/\`concludeCompilerRun\` and writes \`reports/run-<id>.json\`, but no run has ` +
      `been executed against this checkout since that landed, so there is nothing to read. Remedy: run ` +
      `\`pnpm ingest:trust-index\`. An absent report is REFUSED and never 0/0`,
  )
} else if (runReport.report.attempts.artifacts === null) {
  refused(
    "adapter-failure-rate",
    `run ${runReport.report.runId} ran with artifact resolution DISABLED ` +
      `(\`TRUST_INGEST_ARTIFACTS=0\`), so it made no adapter attempts. This is reported as REFUSED and ` +
      `not as 0% because a stage that did not run is a different fact from a stage that ran cleanly — ` +
      `\`${rel(runReport.path)}\``,
  )
} else {
  const a = runReport.report.attempts.artifacts
  const failed = a.unavailable + a.rejected
  const attempted = failed + a.fetched + a.cached
  if (attempted === 0) {
    refused(
      "adapter-failure-rate",
      `run ${runReport.report.runId} attempted 0 artifact resolutions (considered ${a.considered}, ` +
        `all ${a.skippedNoAdapter} skipped for want of an adapter), so a failure rate would be 0/0. ` +
        `REFUSED rather than reported as 0% — the empty-denominator defect — \`${rel(runReport.path)}\``,
    )
  } else {
    const pct = ((failed / attempted) * 100).toFixed(1)
    measured(
      "adapter-failure-rate",
      failed <= attempted,
      `${pct}% of ATTEMPTED adapter resolutions failed (${failed}/${attempted} = ` +
        `${a.unavailable} unavailable + ${a.rejected} rejected, over ${a.fetched} fetched + ` +
        `${a.cached} cached + those failures). ${a.skippedNoAdapter} of ${a.considered} considered were ` +
        `never attempted (no adapter) and are excluded from BOTH halves. Source: run ` +
        `${runReport.report.runId} (${runReport.report.outcome}), \`${rel(runReport.path)}\``,
    )
  }
}

refused(
  "processing-time-mean-p95",
  `blocked on SCHEMA, not on a missing driver: \`compiler_jobs\` has \`created_at\`/\`updated_at\`/` +
    `\`available_at\` and no \`started_at\`/\`finished_at\` ` +
    `(\`migrations/001-canonical-adoption-graph.sql\`), so no duration is recorded anywhere. Adding the ` +
    `columns breaks the 14-column ↔ 14-property equality \`domain/job.ts:13\` documents, so it needs a ` +
    `migration and an ADR — running the compiler cannot unblock this (S1-OPEN-1)`,
)
/**
 * Measure 5 — CAS dedup rate. The second measure this ladder gave a source, and the fourth instance
 * of one fault class to be closed by building the writer its reader had always assumed.
 *
 * WHAT CHANGED. `cas/manifests` was declared in `INDEX_SUBDIRS` from the first commit and censused by
 * this gate from its own first commit, with no writer anywhere in the repo — so the census printed
 * `cas/manifests=0` forever and this measure refused for a reason it stated exactly: a dedup rate is
 * `distinct blobs ÷ manifest references`, and the denominator had never been produced by anything.
 * `artifacts/casManifest.ts` now writes it (ADR 0093), so the denominator exists.
 *
 * WHY THE NUMERATOR IS NOT `deduplicated`. Two different reuse facts live in one manifest and they are
 * NOT the same number:
 *
 *   references − distinctDigests   reuse WITHIN this run: references that resolved to a digest another
 *                                  reference in the same run also resolved to.
 *   deduplicated                   references whose bytes were ALREADY on disk when the run reached
 *                                  them — which includes every blob a previous run stored.
 *
 * A run that fetched 40 unique artifacts into a warm store reports `deduplicated: 40` and within-run
 * reuse 0. A run that requested one blob 40 times reports within-run reuse 39. Both are "high dedup"
 * and they mean opposite things about the store, so BOTH are printed and neither is called "the" rate.
 * That is the same discipline the run report follows in shipping denominators beside numerators.
 *
 * THE ZERO-DENOMINATOR BRANCH STILL REFUSES, and that is the point of having built this rather than a
 * counter: `45 blobs / 0 manifests → 100%` was the original defect, a non-zero numerator over a zero
 * denominator, and a manifest with zero references reproduces it exactly. A manifest that exists and
 * references nothing is a real fact about a real run, and it is still not a rate.
 *
 * The blob census is cross-checked against the manifest rather than divided into it. `casBlobsTotal`
 * counts files across ALL candidate stores while a manifest belongs to ONE run in ONE store, so a
 * ratio between them would be two populations wearing one fraction — the mis-rooted-store defect this
 * gate's own census exists to prevent. Distinct digests come from the manifest, whose references are
 * what the run actually asked for.
 */
if (casManifest === null && rejectedManifests.length > 0) {
  // A manifest EXISTS and this gate cannot read it. Do not tell the reader to run an ingest — one ran.
  refused(
    "cas-dedup-rate",
    `${rejectedManifests.length} CAS manifest file(s) found and NONE readable, so the denominator is ` +
      `present-but-uninterpretable rather than absent — an ingest HAS run and this gate cannot read what ` +
      `it wrote. Running another will not help. Each reason is the specific clause that rejected it: ` +
      `${rejectedManifests.join("; ")}`,
  )
} else if (casManifest === null) {
  // The census counts every FILE under `cas/manifests`; `newestCasManifest` only opens the ones named
  // `run-<id>.json`. When those two disagree, a file exists that neither `best` nor `rejected` can
  // see — invisible to this measure while sitting in its own directory, which is this gate's own fault
  // class one level down. So the count is stated rather than left out of the refusal: an unexplained
  // difference here is the tell that a writer is using a name this reader does not know.
  const unscanned =
    casManifestsTotal > 0
      ? ` The census counts ${casManifestsTotal} file(s) under \`cas/manifests\` that this reader did ` +
        `not open, because it opens only \`run-<id>.json\` — a manifest under any other name is ` +
        `invisible here and that difference is the finding, not a rounding detail.`
      : ``
  refused(
    "cas-dedup-rate",
    `no CAS manifest exists in any candidate store, so dedup has no DENOMINATOR: the rate is distinct ` +
      `blobs ÷ manifest references, and with no manifest there is nothing the ${casBlobsTotal} blob(s) ` +
      `were deduplicated against. Reporting ${casBlobsTotal}/0 as 100% would be the empty-denominator ` +
      `defect with a non-zero numerator — the harder version to spot. The writer now EXISTS ` +
      `(\`artifacts/casManifest.ts\`, ADR 0093), unlike when this refusal was permanent, so this is ` +
      `"no run yet in this checkout" and is closed by running \`pnpm ingest:trust-index\` with ` +
      `artifact resolution enabled — not by building anything (S1-OPEN-1).${unscanned}`,
  )
} else if (casManifest.manifest.totals.references === 0) {
  refused(
    "cas-dedup-rate",
    `run ${casManifest.manifest.runId} wrote a manifest that references NO blobs, so the denominator is ` +
      `zero: the artifact stage ran and resolved nothing to the CAS. REFUSED rather than reported as ` +
      `0% or 100% — the empty-denominator defect, which a present manifest reproduces exactly as an ` +
      `absent one did. \`${rel(casManifest.path)}\``,
  )
} else {
  const t = casManifest.manifest.totals
  const withinRun = t.references - t.distinctDigests
  const withinPct = ((withinRun / t.references) * 100).toFixed(1)
  const alreadyPct = ((t.deduplicated / t.references) * 100).toFixed(1)
  measured(
    "cas-dedup-rate",
    // Both must hold, and each catches a different impossibility: more distinct digests than
    // references means the recount in `checkCasManifest` is wrong, and more deduplicated than
    // references means the writer counted a reference twice. Neither can fire today; a green
    // assertion that cannot fire is why the negative controls run.
    t.distinctDigests <= t.references && t.deduplicated <= t.references,
    `${withinPct}% within-run reuse (${withinRun}/${t.references} references resolved to a digest ` +
      `another reference in the same run also resolved to, over ${t.distinctDigests} distinct blob(s)), ` +
      `and ${alreadyPct}% already-on-disk (${t.deduplicated}/${t.references} references whose bytes were ` +
      `in the CAS before this run reached them, including blobs earlier runs stored). Reported as TWO ` +
      `counts, not one "dedup rate": they answer different questions and a single number would be read ` +
      `as whichever one the reader had in mind. Store census holds ${casBlobsTotal} blob file(s) across ` +
      `ALL candidates, cross-checked rather than divided into — a manifest is one run in one store. ` +
      `Source: run ${casManifest.manifest.runId}, \`${rel(casManifest.path)}\``,
  )
}

refused(
  "disk-growth",
  `blocked on TIME: growth needs two measurements separated by real runs, and only one exists. ` +
    `Baseline recorded today — largest store ${rel(primary.root)} at ${primary.dbBytes}B, ` +
    `${casBlobsTotal} CAS blob(s), ${runReport === null ? 0 : 1}+ run report(s). A single measurement ` +
    `is not a rate (S1-OPEN-1)`,
)

//---------------------------------------------------------------------------------------------------
// Report
//---------------------------------------------------------------------------------------------------
const measuredOnly = measures.filter((m) => m.outcome.kind === "measured")
const refusedOnly = measures.filter((m) => m.outcome.kind === "refused")
const measuredAllOk = measuredOnly.every((m) => m.outcome.kind === "measured" && m.outcome.ok)
const cohortShort = censusSource < S1_REQUIRED_RECORDS
const cohortRegressed = ratchetFloor !== null && censusServed < ratchetFloor

console.log(`\n=== Gate S1 — the ${S1_REQUIRED_RECORDS}-record scale slice ===\n`)
console.log(`Cohort census:`)
console.log(
  `  Source:    ${censusSource} / ${S1_REQUIRED_RECORDS} required ${cohortShort ? "(SHORTFALL)" : "(met)"}`,
)
console.log(
  `  Served:    ${censusServed} registry page(s)` +
    (ratchetFloor === null
      ? ` (ratchet floor unavailable — snapshot unreadable)`
      : ` / ${ratchetFloor} committed ${cohortRegressed ? "(REGRESSED — served tree fell behind source)" : "(held)"}`),
)
console.log(``)

console.log(`Measures (${measuredOnly.length} with a committed source, ${refusedOnly.length} refused):`)
for (const m of measures) {
  const mark = m.outcome.kind === "refused" ? "✗" : m.outcome.ok ? "✓" : "✗"
  console.log(`  [${m.tier.padEnd(8)}] ${m.id.padEnd(26)} ${mark}  ${m.outcome.message}`)
}
console.log(``)

// Printed unconditionally, in EVERY mode, and that is deliberate: the first version's whole defect was
// a claim about a store it never named the location of. A census that only appears on failure would
// leave the passing runs — the ones nobody inspects — carrying the same unverifiable claim.
console.log(`Compiler store candidates (location follows \`cwd\`, so there is more than one):`)
console.log(storeCensus)
console.log(``)

//---------------------------------------------------------------------------------------------------
// Exit
//---------------------------------------------------------------------------------------------------
if (isGate) {
  const problems: string[] = []
  if (!measuredAllOk) {
    problems.push(
      `${measuredOnly.filter((m) => m.outcome.kind === "measured" && !m.outcome.ok).length} measured assertion(s) failed`,
    )
  }
  if (refusedOnly.length > 0) problems.push(`${refusedOnly.length} measure(s) REFUSED (no data source)`)
  if (cohortShort) problems.push(`cohort ${censusSource} < ${S1_REQUIRED_RECORDS} required`)
  if (problems.length > 0) {
    console.error(
      `❌ Gate S1 (--gate) FAILED: ${problems.join("; ")}.\n` +
        `   The full S1 claim needs all seven measures. Four have no data source in this checkout,\n` +
        `   which is a real finding about the compiler's reach — not a reason to soften the gate.`,
    )
    process.exit(2)
  }
  console.log(`✓ Gate S1: all seven measures pass and the cohort meets the requirement\n`)
  process.exit(0)
}

if (isRegression) {
  const problems: string[] = []
  if (!measuredAllOk) {
    for (const m of measuredOnly) {
      if (m.outcome.kind === "measured" && !m.outcome.ok) problems.push(`${m.id}: ${m.outcome.message}`)
    }
  }
  if (cohortRegressed) {
    problems.push(
      `served registry pages ${censusServed} fell below the committed cohort ${ratchetFloor} — a source record has no page`,
    )
  }
  if (problems.length > 0) {
    console.error(`❌ Gate S1 (--regression) FAILED:\n${problems.map((p) => `   - ${p}`).join("\n")}`)
    process.exit(2)
  }
  console.log(
    `✓ Gate S1 (--regression): ${measuredOnly.length} measure(s) with a committed source pass; ` +
      `served ${censusServed} holds the committed cohort. ` +
      `${refusedOnly.length} runtime measure(s) reported as REFUSED, not enforced here\n`,
  )
  process.exit(0)
}

// Report mode: exit 0 even with refusals. Measuring an absent data source is a successful
// measurement, and a report mode that could fail would be a third enforcing mode by accident.
console.log(
  cohortShort
    ? `Report mode: cohort is SHORT of the ${S1_REQUIRED_RECORDS}-record requirement — reported, not enforced here\n`
    : `Report mode: cohort meets the ${S1_REQUIRED_RECORDS}-record requirement; ${refusedOnly.length} measure(s) await a compiler run\n`,
)
process.exit(0)
