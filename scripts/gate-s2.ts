#!/usr/bin/env tsx
/**
 * Gate S2 — the 500-record scale slice (new15 Execution Plan §27, one rung above S1).
 *
 * S2 sits on the expansion ladder S0(25) → S1(100) → S2(500) → S3(all) → S4(second source). S0 asks
 * "is the vertical slice correct?"; S1 asks "did correctness survive 100?"; S2 asks the same question
 * at 500.
 *
 * ## WHY THIS FILE EXISTS BEFORE ITS THRESHOLD, WHICH IS THE ENTIRE POINT
 *
 * S1 was written AFTER its threshold had been crossed. Nothing redded when the cohort passed 100 —
 * because there was nothing to red. That is this repository's dominant fault class in its purest form:
 * not a guard blind to its subject, but a threshold with NO GUARD AT ALL. `artifacts/gate-s1/
 * open-items.md` opened S1-OPEN-2 to stop it recurring one rung up, and stated the closing condition
 * as this file plus `artifacts/gate-s2/open-items.md` existing BEFORE the served cohort reaches 500.
 *
 * The cohort is 150 today and auto-grows +50 per ingest run toward `CUMULATIVE_COVERAGE_CEILING`
 * (`packages/trust-index/src/fetchRegistry.ts:47`), driven by a weekly cron (`trust-ingest.yml:19`).
 * That is ~7 runs. So this gate is deliberately RED on `--gate` today, and the redness is the feature:
 * a gate that only appears once its threshold is met can never have been the thing that measured it.
 *
 * ## THE PROBLEM S2 HAS AND S1 DID NOT
 *
 * S1's threshold had already been met, so S1 could assert `censusSource >= 100` as a plain
 * requirement. S2's has not been met, AND MAY NEVER BE, for reasons that are not defects: the
 * compiler's store holds 298 canonical subjects, and NOTHING IN THE REPO RECORDS HOW MANY LIVE
 * RECORDS UPSTREAM ACTUALLY HAS. The snapshot's `count` is what WE emitted (150), never upstream's
 * total.
 *
 * So a naive `served < 500 → FAIL` would pin CI red on a fact about the MCP registry's size, and a
 * reader would "fix" it by raising a cap that was never the binding limit. A shortfall has two causes
 * that need OPPOSITE actions:
 *
 *   - upstream holds fewer than 500 live records  → not a defect; no local change fixes it
 *   - our own cap ended the read                  → a defect; raise the NAMED knob
 *
 * `cohort-completeness` therefore REFUSES rather than fails, and the refusal names which. UNKNOWN is
 * not SAFE — the product's own principle, applied to its own gate — and an unattributable shortfall is
 * an unknown, so it is never reported as either a pass or a failure.
 *
 * The evidence that resolves it is `SyncSourceResult.capReached` / `truncationReason`
 * (`packages/adoption-index/src/operations/syncSource.ts:77-88`), carried into the run report's
 * `source` section as of schema v2. When no v2 report exists, this gate says the attribution is
 * UNKNOWN and does not guess — it does NOT fall back to "upstream must be small", which is the
 * confidently-wrong-reason defect `checkRunReport` was rebuilt to avoid.
 *
 * ## WHAT S2 DELIBERATELY DOES NOT MEASURE
 *
 * S1's four RUNTIME measures (adapter failure rate, processing time, CAS dedup, disk growth) are not
 * repeated. Three are blocked on SCHEMA / a missing writer / elapsed time against THE SAME STORE, so
 * duplicating them would produce a second gate that cannot pass for reasons S1 already owns and
 * reports. Two gates refusing the same measure for the same reason is not twice the coverage; it is
 * one finding printed twice, and a reader who fixes it must then find both.
 *
 * The three measures S2 DOES share with S1 (`source-completeness`, `artifact-resolution`,
 * `page-quality`) are not duplication either: S1's question is "did correctness survive 100?", S2's is
 * "did it survive 500?", and the same assertion at a different cohort size is the whole point of a
 * scale ladder.
 *
 * Everything importable is IMPORTED, never re-derived — `parseSnapshot`, `registryCanonicalName`,
 * `synthesizeConfigText`, `REGISTRY_NAMESPACE`. Workstream R measured what a local re-implementation
 * costs: "join on the SLUG: raw 0/19, slug 19/19". A gate with its own copy of the slug rule agrees
 * with itself and disagrees with the bake.
 *
 * Modes:
 *   (default) report — print every measure and the census. Exit 0 even when measures are REFUSED,
 *                      because reporting an absent data source IS a successful measurement.
 *   --gate           — ENFORCEMENT of the full S2 claim. Exit 2 if any measure fails or is REFUSED.
 *                      RED TODAY, correctly, because the cohort is 150 and the shortfall is
 *                      unattributable.
 *   --regression     — ENFORCEMENT of the four measures with a committed source, plus a monotonic
 *                      served floor. Green today; reds when a measure regresses or the cohort shrinks.
 *
 * `--gate --regression` is refused rather than resolved by precedence, exactly as in S0 and S1: they
 * enforce different claims, and picking one silently would let a caller believe the other ran.
 *
 * NOTHING HERE OPENS A SOCKET. Every number comes from committed bytes or the local compiler store; a
 * network fetch would make the verdict depend on upstream's mood (INV-M4).
 *
 * Exit codes: 0 ok · 2 gate failed (--gate / --regression) / unexpected error.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// The SHIPPED slugifier and snapshot reader, imported rather than re-derived — see the docblock above.
import {
  parseSnapshot,
  registryCanonicalName,
  synthesizeConfigText,
  REGISTRY_NAMESPACE,
} from "../packages/trust-index/src/snapshot.js"
// The auto-growth curve's own constants. `CUMULATIVE_COVERAGE_CEILING` IS S2's threshold: importing it
// means the gate cannot disagree with the mechanism that will (or will not) reach it. A literal 500
// here would be a second copy of the ceiling, free to drift from the one that actually caps the read.
import {
  CUMULATIVE_COVERAGE_CEILING,
  CUMULATIVE_COVERAGE_STEP,
} from "../packages/trust-index/src/fetchRegistry.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const rel = (p: string): string => path.relative(repoRoot, p).replace(/\\/g, "/")

/**
 * The record floor S2 names — a REQUIREMENT, not a cap, and IMPORTED rather than written.
 *
 * `CUMULATIVE_COVERAGE_CEILING` is both the ladder's S2 rung and the ceiling the auto-growth curve
 * climbs toward, and those two numbers must be the same number or the gate measures a threshold the
 * pipeline is not aiming at.
 */
const S2_REQUIRED_RECORDS = CUMULATIVE_COVERAGE_CEILING

/**
 * The ratchet floor for `--regression`: the registry cohort must not shrink below this.
 *
 * DERIVED from the committed snapshot, never written down — S1's `committedRegistryCohort` pattern and
 * the same reason ADR 0083 gave for S0's: a hardcoded floor is a number someone edits downward to make
 * a red CI green. Reading the snapshot means the floor IS the achievement and cannot lead it.
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
      `   --gate       = the full S2 claim (all five measures + the ${S2_REQUIRED_RECORDS}-record requirement)\n` +
      `   --regression = the four measures with a committed data source + the cohort floor`,
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
 * This is `gate-s1.ts`'s `storeCandidates` seam, deliberately reproduced rather than narrowed. S1's
 * first version read only the repo root and printed "the rolling compiler has not run against this
 * checkout" while `packages/trust-index/.var/` held a 2.5 MB database with 298 canonical subjects —
 * a guard reporting truthfully about the wrong directory. `ADOPTION_INDEX_CWD` is honoured FIRST
 * because `pruneCas.ts:59` and `backupAdoptionIndex.ts:52` already treat it as the store's override
 * seam; a second convention here would split the seam in two.
 */
const STORE_DIRNAME = ".var/calllint-adoption-index"
const storeCandidates: readonly string[] = [
  ...((process.env.ADOPTION_INDEX_CWD ?? "").trim()
    ? [path.join((process.env.ADOPTION_INDEX_CWD ?? "").trim(), STORE_DIRNAME)]
    : []),
  path.join(repoRoot, STORE_DIRNAME),
  path.join(repoRoot, "packages/trust-index", STORE_DIRNAME),
]

interface ServedEntry {
  readonly canonicalName: string
  readonly status: string
  readonly verdict: string | null
  readonly artifactDigest?: string
  readonly pageDigest?: string
}

/**
 * A measure's outcome. `refused` is a first-class outcome and CARRIES NO `ok` FIELD, so it cannot be
 * summed into a pass rate even by accident: the exit logic must treat "the source is absent" and "the
 * source disagrees" differently, because the remedies differ (populate a store vs. fix a bake).
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
// Store footprints + the newest run report. Needed by `cohort-completeness`, so it is built BEFORE the
// measures rather than after them (S1 builds it later because only its runtime measures read it).
//---------------------------------------------------------------------------------------------------
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
 * Count FILES beneath `p`, RECURSIVELY — not top-level entries.
 *
 * S1's first version used `readdirSync(dir).length`, which on `cas/blobs` counts the two-character
 * fan-out SHARDS rather than blobs: 42 shards for 45 blobs, an undercount that grows as shards
 * collide. `paths.ts:117-118` warns that the blob tree is a fan-out while `work/` is flat and that
 * "callers must not assume a shared traversal shape". Recursing is correct for both shapes.
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

/**
 * The store census, EVERY candidate listed — because naming only the winner would hide the very
 * divergence that made S1's first version wrong. Printed unconditionally in every mode, including the
 * passing ones: a census that appears only on failure leaves the runs nobody inspects carrying an
 * unverifiable claim.
 */
const storeCensus = footprints
  .map(
    (f) =>
      `    ${rel(f.root)}: cas/blobs=${f.casBlobs}, cas/manifests=${f.casManifests}, ` +
      `dead-letter=${f.deadLetter}, reports=${f.reports}, db=${f.dbBytes}B${f.exists ? "" : " (absent)"}`,
  )
  .join("\n")

/**
 * The schema ids this gate can read, ENUMERATED and matched EXACTLY — never by prefix.
 *
 * S2 requires **v2 or later that it knows**, because `source` is the only section it reads and v1 does
 * not have one. A v1 report is therefore not "invalid" here: it is a report that cannot answer this
 * gate's question, which is a DIFFERENT refusal from a malformed file and is reported as such.
 *
 * `calllint.compiler-run-report.` + `startsWith` would accept a v3 that renamed `capReached`, and this
 * gate branches on that field's truth value. The only thing a version number buys is the right to
 * refuse a shape you have not read.
 */
const SOURCE_AWARE_SCHEMAS = ["calllint.compiler-run-report.v2"] as const
const V1_SCHEMA = "calllint.compiler-run-report.v1"

/** Only the fields THIS gate reads. Narrower than the writer's shape, on purpose. */
interface SourceReportShape {
  readonly schema: string
  readonly runId: string
  readonly completedAt: string
  readonly source: {
    readonly recordsRead: number
    readonly capReached: boolean
    readonly truncationReason: string | null
    readonly snapshotMaxEntries: number
    readonly mirrorMaxEntries: number
  } | null
}

/**
 * Why a report was not usable, in the words of the branch that decided.
 *
 * `checkSourceReport` returns a REASON rather than a boolean because the caller cannot reconstruct one.
 * S1 shipped that defect and it is recorded in `gate-s1.ts`: the first `isRunReport` was a type guard
 * over four rules, its caller could only still see `schema`, so it printed both candidate causes joined
 * by "or" — and on a report whose schema matched exactly, that rendered as a sentence denying its own
 * first clause. A description assembled by a SECOND reader of the same value drifts from what the check
 * actually rejected. The reason must be produced by the check, in the branch that decided.
 *
 * `kind` is carried alongside the prose because this gate's caller must do more than print: a v1 report
 * (`too-old`) means "run an ingest with the current writer", a malformed one (`invalid`) means
 * "reconcile the writer", and a v2 report with `source: null` (`unmeasured`) means "the run crashed
 * before its mirror returned". Three remedies; a single boolean could not route them, and re-deriving
 * the kind from the prose is how the two drift apart.
 */
type SourceReportCheck =
  | { readonly ok: true; readonly report: SourceReportShape }
  | { readonly ok: false; readonly kind: "invalid" | "too-old" | "unmeasured"; readonly reason: string }

function checkSourceReport(v: unknown): SourceReportCheck {
  if (typeof v !== "object" || v === null) {
    return { ok: false, kind: "invalid", reason: "not a JSON object" }
  }
  const r = v as Record<string, unknown>
  if (typeof r.schema !== "string") {
    return { ok: false, kind: "invalid", reason: "no readable `schema` field" }
  }
  // v1 is called out BY NAME and as its own kind. It is not a malformed file — it is a valid report
  // from a writer that did not yet record source coverage, and telling its operator to "reconcile the
  // writer" would send them to fix something that is not broken.
  if (r.schema === V1_SCHEMA) {
    return {
      ok: false,
      kind: "too-old",
      reason: `schema \`${V1_SCHEMA}\` predates the \`source\` section (added in v2), so it cannot say whether the read was capped`,
    }
  }
  if (!(SOURCE_AWARE_SCHEMAS as readonly string[]).includes(r.schema)) {
    return {
      ok: false,
      kind: "invalid",
      reason: `schema \`${r.schema}\`, not ${SOURCE_AWARE_SCHEMAS.map((s) => `\`${s}\``).join(" or ")}`,
    }
  }
  const found = r.schema
  for (const k of ["runId", "completedAt"] as const) {
    if (typeof r[k] !== "string") {
      return { ok: false, kind: "invalid", reason: `schema \`${found}\` but \`${k}\` is missing or not a string` }
    }
  }
  // `source: null` is a MEANINGFUL value, not an absence: it is how the writer records a run that threw
  // before its mirror returned. Distinguished from a missing key, which is a malformed file — the same
  // not-run-vs-ran-and-counted-zero distinction `attempts.artifacts` keeps in v1.
  if (!("source" in r)) {
    return { ok: false, kind: "invalid", reason: `schema \`${found}\` but \`source\` is missing entirely` }
  }
  if (r.source === null) {
    return {
      ok: false,
      kind: "unmeasured",
      reason: `schema \`${found}\` with \`source: null\` — the run did not complete far enough to measure its source coverage`,
    }
  }
  if (typeof r.source !== "object") {
    return { ok: false, kind: "invalid", reason: `schema \`${found}\` but \`source\` is neither an object nor null` }
  }
  const s = r.source as Record<string, unknown>
  if (typeof s.capReached !== "boolean") {
    return {
      ok: false,
      kind: "invalid",
      reason: `schema \`${found}\` but \`source.capReached\` is ${s.capReached === undefined ? "missing" : `${JSON.stringify(s.capReached)}, not a boolean`}`,
    }
  }
  if (!(typeof s.truncationReason === "string" || s.truncationReason === null)) {
    return {
      ok: false,
      kind: "invalid",
      reason: `schema \`${found}\` but \`source.truncationReason\` is ${s.truncationReason === undefined ? "missing" : `${JSON.stringify(s.truncationReason)}, not a string or null`}`,
    }
  }
  for (const k of ["recordsRead", "snapshotMaxEntries", "mirrorMaxEntries"] as const) {
    if (!Number.isInteger(s[k]) || (s[k] as number) < 0) {
      return {
        ok: false,
        kind: "invalid",
        reason: `schema \`${found}\` but \`source.${k}\` is ${s[k] === undefined ? "missing" : `${JSON.stringify(s[k])}, not a non-negative integer`}`,
      }
    }
  }
  return { ok: true, report: v as SourceReportShape }
}

/**
 * The newest source-aware run report across every candidate store, plus why each rejected file was
 * rejected.
 *
 * Newest by `completedAt` STRING COMPARISON, which is correct because the writer emits ISO-8601 UTC
 * (lexical order = chronological order for that format) and needs no clock read here — a gate that read
 * the clock would produce a different answer on a different day for the same bytes.
 *
 * Tolerant on the way in, strict on the way out: a missing, unreadable, non-JSON, wrong-version or
 * field-drifted file is SKIPPED WITH ITS REASON rather than crashed on, because a gate that dies on one
 * malformed report tells the reader nothing about the other four measures. But a skipped report is never
 * downgraded to a default — "no report" and "a report that says the source was exhausted" must stay
 * distinguishable, and that distinction is this gate's headline measure.
 */
function newestSourceReport(): {
  best: { report: SourceReportShape; path: string } | null
  rejected: { path: string; kind: "invalid" | "too-old" | "unmeasured"; reason: string }[]
} {
  let best: { report: SourceReportShape; path: string } | null = null
  const rejected: { path: string; kind: "invalid" | "too-old" | "unmeasured"; reason: string }[] = []
  for (const f of footprints) {
    const dir = path.join(f.root, "reports")
    if (!existsSync(dir)) continue
    let entries: string[]
    try {
      entries = readdirSync(dir).filter((e) => e.endsWith(".json"))
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e)
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(p, "utf8"))
      } catch {
        rejected.push({ path: rel(p), kind: "invalid", reason: "not parseable as JSON" })
        continue
      }
      const checked = checkSourceReport(parsed)
      if (!checked.ok) {
        rejected.push({ path: rel(p), kind: checked.kind, reason: checked.reason })
        continue
      }
      if (best === null || checked.report.completedAt > best.report.completedAt) {
        best = { report: checked.report, path: p }
      }
    }
  }
  return { best, rejected }
}

const { best: sourceReport, rejected: rejectedReports } = newestSourceReport()

/**
 * Which environment knob governs each truncation exit — `syncSource`'s own three reasons.
 *
 * `cursor-repeat` maps to `null` deliberately: it means the source returned a cursor it had already
 * given us, which no local setting fixes. Inventing a knob for it would send an operator to change a
 * value that cannot affect the outcome, and the ONLY reason `truncationReason` exists as a separate
 * field from `capReached` is that this case has no answer.
 */
const TRUNCATION_REMEDY: Record<string, string | null> = {
  "record-cap": "TRUST_INGEST_MIRROR_MAX_ENTRIES",
  "page-cap": "TRUST_INGEST_MIRROR_MAX_PAGES",
  "cursor-repeat": null,
}

//---------------------------------------------------------------------------------------------------
// Measure 1 — COHORT COMPLETENESS (REFUSED below the threshold, and the refusal ATTRIBUTES the
// shortfall).
//
// This is the measure S2 exists for, and the only one whose verdict is not a pass/fail. A cohort under
// 500 has two causes needing opposite actions, and this gate has no standing to guess between them:
// nothing in the repo records upstream's live total. So it refuses, and says which of three states it
// is in — upstream exhausted, our cap bound the read, or ATTRIBUTION UNKNOWN.
//
// "Unknown" is a real outcome here, not a fallback. Reporting "upstream must hold fewer than 500"
// without evidence would be the confidently-wrong reason: consumed and acted on, sending someone to
// accept a shortfall that our own cap in fact caused.
//---------------------------------------------------------------------------------------------------
if (censusSource >= S2_REQUIRED_RECORDS) {
  measured(
    "cohort-completeness",
    true,
    `${censusSource}/${S2_REQUIRED_RECORDS} source records — the S2 threshold is MET`,
  )
} else {
  const shortfall = S2_REQUIRED_RECORDS - censusSource
  const runsToGo = Math.ceil(shortfall / CUMULATIVE_COVERAGE_STEP)
  const growth =
    `cohort ${censusSource}/${S2_REQUIRED_RECORDS} (short by ${shortfall}; ` +
    `+${CUMULATIVE_COVERAGE_STEP}/run ⇒ ~${runsToGo} more ingest run(s) if upstream has the records)`

  if (sourceReport === null) {
    // No usable report. The reasons are enumerated so the remedy is specific — and each `kind` gets its
    // own sentence, because "run an ingest" and "reconcile the writer" are not interchangeable advice.
    const byKind = {
      "too-old": rejectedReports.filter((r) => r.kind === "too-old"),
      unmeasured: rejectedReports.filter((r) => r.kind === "unmeasured"),
      invalid: rejectedReports.filter((r) => r.kind === "invalid"),
    }
    let why: string
    if (rejectedReports.length === 0) {
      why =
        `no run report exists in any candidate store, so nothing recorded whether the last read was ` +
        `capped. Remedy: run \`pnpm ingest:trust-index\` (it writes a v2 report as it goes)`
    } else if (byKind["too-old"].length > 0 && byKind.unmeasured.length === 0 && byKind.invalid.length === 0) {
      why =
        `${byKind["too-old"].length} report(s) exist but ALL predate the \`source\` section: ` +
        `${byKind["too-old"].map((r) => `${r.path} (${r.reason})`).slice(0, 3).join("; ")}. ` +
        `Remedy: run \`pnpm ingest:trust-index\` once with the current writer — do NOT edit the old ` +
        `reports, they are accurate records of runs that did not measure this`
    } else {
      // Mixed kinds, or a single kind that is not `too-old`. The remedy list names ONLY the kinds
      // actually present — an unconditional three-way menu would make the reader match their own file
      // against it, which is the OR-of-candidate-causes defect in a milder dress: every clause is true
      // of some file, and none is asserted of theirs.
      const REMEDY_BY_KIND = {
        "too-old": "`too-old` needs an ingest run with the current writer",
        unmeasured: "`unmeasured` means that run crashed before its mirror returned — check the run's own logs",
        invalid:
          "`invalid` needs `checkSourceReport` here reconciled with " +
          "`packages/adoption-index/src/storage/runReport.ts`",
      } as const
      const present = (["too-old", "unmeasured", "invalid"] as const).filter((k) => byKind[k].length > 0)
      why =
        `${rejectedReports.length} report(s) exist and none can answer this: ` +
        `${rejectedReports.map((r) => `${r.path} [${r.kind}] (${r.reason})`).slice(0, 3).join("; ")}` +
        `${rejectedReports.length > 3 ? ` (+${rejectedReports.length - 3} more)` : ""}. ` +
        `Remedy: ${present.map((k) => REMEDY_BY_KIND[k]).join("; ")}`
    }
    refused(
      "cohort-completeness",
      `${growth}. UPSTREAM EXHAUSTION UNKNOWN — ${why}. This shortfall is NOT attributed: it may be ` +
        `upstream holding fewer than ${S2_REQUIRED_RECORDS} live records (not a defect, no local fix) ` +
        `or our own cap ending the read (a defect, fixed by raising a named knob). UNKNOWN is not SAFE, ` +
        `so neither is claimed`,
    )
  } else if (sourceReport.report.source === null) {
    // Defensive: `checkSourceReport` classifies this as `unmeasured` and never returns it as ok, so this
    // branch is unreachable today. Kept because the alternative is a non-null assertion, and a `!` here
    // would be the one place this file asserts a fact about a file it did not write.
    refused(
      "cohort-completeness",
      `${growth}. UPSTREAM EXHAUSTION UNKNOWN — the newest report ${rel(sourceReport.path)} carries no ` +
        `\`source\` section`,
    )
  } else if (sourceReport.report.source.capReached) {
    const reason = sourceReport.report.source.truncationReason
    const knob = reason === null ? undefined : TRUNCATION_REMEDY[reason]
    // OUR CAP BOUND THE READ. This is the actionable half, and the knob is named rather than described,
    // because "raise the limit" without a variable name is what sends an operator to the wrong one —
    // there are two caps in force and they are not interchangeable.
    const remedy =
      reason === null
        ? `the report says capped but records no reason, so the binding limit cannot be named — ` +
          `reconcile the writer: \`syncSource\` sets both fields together`
        : knob === null
          ? `exit \`${reason}\` has NO local knob: the source returned a cursor it had already given us, ` +
            `so no configuration change extends this read`
          : knob === undefined
            ? `exit \`${reason}\` is not one this gate knows (\`record-cap\`, \`page-cap\`, ` +
              `\`cursor-repeat\`), so it will not guess a knob for it`
            : `raise \`${knob}\``
    refused(
      "cohort-completeness",
      `${growth}. THE SHORTFALL IS OURS, NOT UPSTREAM'S: the newest run (${rel(sourceReport.path)}) ended ` +
        `at a LIMIT, not at the end of the source — read ${sourceReport.report.source.recordsRead} record(s) ` +
        `with caps snapshot=${sourceReport.report.source.snapshotMaxEntries}, ` +
        `mirror=${sourceReport.report.source.mirrorMaxEntries}. Remedy: ${remedy}. Upstream may well hold ` +
        `${S2_REQUIRED_RECORDS}+ records; this run never found out`,
    )
  } else {
    // UPSTREAM WAS EXHAUSTED. The strong claim, and the report is entitled to it: `syncSource` reports the
    // ambiguous case (a source holding EXACTLY `maxEntries`) as capped, so `false` means the read reached
    // the end. Still REFUSED rather than failed — the threshold is genuinely unmet, and no local change
    // will meet it.
    refused(
      "cohort-completeness",
      `${growth}. THE SHORTFALL IS UPSTREAM'S, NOT A DEFECT: the newest run (${rel(sourceReport.path)}) read ` +
        `the source TO ITS END — ${sourceReport.report.source.recordsRead} record(s) with caps ` +
        `snapshot=${sourceReport.report.source.snapshotMaxEntries}, ` +
        `mirror=${sourceReport.report.source.mirrorMaxEntries}, neither of which bound it. So upstream held ` +
        `fewer than ${S2_REQUIRED_RECORDS} live records at that time and NO LOCAL CHANGE RAISES THIS ` +
        `COHORT. Remedy: none here — S2's threshold awaits upstream growth (S2-OPEN-1)`,
    )
  }
}

//---------------------------------------------------------------------------------------------------
// Measure 2 — SCALE RETENTION (MEASURED): a name once served is still served.
//
// THE ADR 0086 STICKY-RETENTION PROMISE, and the one thing a +50 growth step can silently break.
// `selectCohortEntries` (`fetchRegistry.ts:142`) keeps previously-published names even when new entries
// sort before them alphabetically — and the cohort is alphabetically ordered, so without stickiness
// every step toward 500 would evict the tail it just published.
//
// WHY THIS IS NOT A RESTATEMENT OF `source-completeness`, WHICH IT WOULD HAVE BEEN. The plan specified
// this measure as "no subject in the committed snapshot is absent from the served tree" — but that is
// measure 3's join, in the same direction, and the two sets are exactly equal today (measured: 150/150,
// 0 either way). A second copy of a passing assertion is not a second measurement.
//
// The direction that is NOT covered elsewhere is the served tree's own history: a page that exists is
// evidence the name was published, and the retention ledger is `retainedNames` — the PREVIOUS snapshot
// (`refreshSnapshot.ts:362`). So this asserts every SERVED name is present in the CURRENT snapshot: a
// served page whose name has left the snapshot is a subject the next bake will not refresh and the next
// cohort selection will not retain, which is eviction in progress rather than eviction already shipped.
//---------------------------------------------------------------------------------------------------
if (snapshotEntries === null || served === null) {
  refused("scale-retention", `input unreadable — ${snapshotError ?? servedError ?? "unknown"}`)
} else {
  const snapshotNames = new Set(snapshotEntries.map((e) => registryCanonicalName(e.name)))
  const orphaned = servedRegistry.map((e) => e.canonicalName).filter((n) => !snapshotNames.has(n))
  measured(
    "scale-retention",
    orphaned.length === 0,
    orphaned.length === 0
      ? `${censusServed}/${censusServed} served name(s) are still in the committed snapshot, so the ` +
          `next cohort selection will retain every one (ADR 0086 stickiness holds)`
      : `${orphaned.length} served page(s) have NO entry in the committed snapshot, so the next ` +
          `selection cannot retain them — eviction in progress: ` +
          `${orphaned.slice(0, 5).join(", ")}${orphaned.length > 5 ? ` (+${orphaned.length - 5} more)` : ""}`,
  )
}

//---------------------------------------------------------------------------------------------------
// Measure 3 — SOURCE COMPLETENESS (MEASURED): every source record reached the served tree.
//
// S1's measure 1, re-asserted at this cohort size — the point of a scale ladder. Keyed through the
// shipped `registryCanonicalName`, so a change to the slug rule moves this join in lockstep with the
// bake's. A miss means a record was fetched and then silently dropped (INV-R5, at scale).
//---------------------------------------------------------------------------------------------------
if (snapshotEntries === null || served === null) {
  refused("source-completeness", `input unreadable — ${snapshotError ?? servedError ?? "unknown"}`)
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
      : `${absent.length} source record(s) absent from the served tree: ` +
          `${absent.slice(0, 5).join(", ")}${absent.length > 5 ? ` (+${absent.length - 5} more)` : ""}`,
  )
}

//---------------------------------------------------------------------------------------------------
// Measure 4 — ARTIFACT RESOLUTION (MEASURED): the two independent readings of "which subjects are
// judgeable" still select the same set.
//
// S1's measure 2 at this scale. No threshold is asserted on the rate itself, because a registry entry
// declaring neither a package nor a remote is a fact about upstream, not a defect here. What IS
// asserted is AGREEMENT: `synthesizeConfigText(e) === null` (the source-side reason a record cannot be
// scanned) must select exactly the set the served index marks incomplete. A disagreement means one side
// is wrong about which subjects are judgeable, which is how a false SAFE gets in.
//---------------------------------------------------------------------------------------------------
if (snapshotEntries === null || served === null) {
  refused("artifact-resolution", `input unreadable — ${snapshotError ?? servedError ?? "unknown"}`)
} else {
  const unresolvableSource = new Set(
    snapshotEntries.filter((e) => synthesizeConfigText(e) === null).map((e) => registryCanonicalName(e.name)),
  )
  const incompleteServed = new Set(servedRegistry.filter((e) => e.status !== "baked").map((e) => e.canonicalName))
  const onlySource = [...unresolvableSource].filter((n) => !incompleteServed.has(n))
  const onlyServed = [...incompleteServed].filter((n) => !unresolvableSource.has(n))
  const resolvable = censusSource - unresolvableSource.size
  const agree = onlySource.length === 0 && onlyServed.length === 0
  measured(
    "artifact-resolution",
    agree,
    agree
      ? `${resolvable}/${censusSource} resolvable; the ${unresolvableSource.size} unresolvable source ` +
          `record(s) are exactly the ${incompleteServed.size} the index marks incomplete`
      : `source and served disagree on which records are judgeable — unresolvable-but-baked: ` +
          `${onlySource.join(", ") || "none"}; incomplete-but-resolvable: ${onlyServed.join(", ") || "none"}`,
  )
}

//---------------------------------------------------------------------------------------------------
// Measure 5 — PAGE QUALITY (MEASURED): every baked subject has its full served trio, and the page's own
// digests agree with the index's.
//
// S1's measure 3 at this scale. "Quality" is read as COMPLETENESS AND SELF-AGREEMENT rather than as a
// rendering judgement: a rendering score needs a threshold nobody has set, while a missing sidecar or a
// page whose digest disagrees with the index is unambiguously broken — and at hundreds of subjects it is
// the fault that scaling actually produces.
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
      ? `${baked.length}/${baked.length} baked subjects carry html+json+manifest and agree with the ` +
          `index on both digests`
      : `${broken.length} defective page(s): ` +
          `${broken.slice(0, 5).join("; ")}${broken.length > 5 ? ` (+${broken.length - 5} more)` : ""}`,
  )
}

//---------------------------------------------------------------------------------------------------
// Report
//---------------------------------------------------------------------------------------------------
const measuredOnly = measures.filter((m) => m.outcome.kind === "measured")
const refusedOnly = measures.filter((m) => m.outcome.kind === "refused")
const measuredAllOk = measuredOnly.every((m) => m.outcome.kind === "measured" && m.outcome.ok)
const cohortRegressed = ratchetFloor !== null && censusServed < ratchetFloor

console.log(`\n=== Gate S2 — the ${S2_REQUIRED_RECORDS}-record scale slice ===\n`)
console.log(`Cohort census:`)
console.log(
  `  Source:    ${censusSource} / ${S2_REQUIRED_RECORDS} required ` +
    `${censusSource >= S2_REQUIRED_RECORDS ? "(met)" : "(SHORTFALL — see cohort-completeness)"}`,
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
  console.log(`  [${m.tier.padEnd(8)}] ${m.id.padEnd(22)} ${mark}  ${m.outcome.message}`)
}
console.log(``)

// Printed unconditionally, in EVERY mode — see `storeCensus`. S1's defect was a claim about a store it
// never named the location of, and a census that appears only on failure leaves the passing runs
// carrying exactly that claim.
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
  if (refusedOnly.length > 0) {
    problems.push(`${refusedOnly.length} measure(s) REFUSED: ${refusedOnly.map((m) => m.id).join(", ")}`)
  }
  if (problems.length > 0) {
    console.error(
      `❌ Gate S2 (--gate) FAILED: ${problems.join("; ")}.\n` +
        `   The full S2 claim needs all five measures at ${S2_REQUIRED_RECORDS} records. The cohort is\n` +
        `   ${censusServed} and growing +${CUMULATIVE_COVERAGE_STEP}/run, so this is EXPECTED to be red\n` +
        `   until the ladder's next rung is actually reached — that is why the gate exists before the\n` +
        `   threshold rather than after it. Read cohort-completeness above for whether the shortfall is\n` +
        `   ours or upstream's; it is refused, not failed, precisely because that question has an answer\n` +
        `   this gate will not guess.`,
    )
    process.exit(2)
  }
  console.log(`✓ Gate S2: all five measures pass and the cohort meets the ${S2_REQUIRED_RECORDS}-record requirement\n`)
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
    console.error(`❌ Gate S2 (--regression) FAILED:\n${problems.map((p) => `   - ${p}`).join("\n")}`)
    process.exit(2)
  }
  console.log(
    `✓ Gate S2 (--regression): ${measuredOnly.length} measure(s) with a committed source pass; ` +
      `served ${censusServed} holds the committed cohort. ` +
      `${refusedOnly.length} measure(s) reported as REFUSED, not enforced here\n`,
  )
  process.exit(0)
}

console.log(
  censusSource >= S2_REQUIRED_RECORDS
    ? `Report mode: cohort meets the ${S2_REQUIRED_RECORDS}-record requirement; ` +
        `${refusedOnly.length} measure(s) refused`
    : `Report mode: cohort ${censusSource}/${S2_REQUIRED_RECORDS} — the threshold is not yet reached, and ` +
        `cohort-completeness above says whether that is ours to fix\n`,
)
