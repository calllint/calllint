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
 * and the compiler's local store is empty: `.var/calllint-adoption-index/db/adoption-index.sqlite`
 * holds 0 rows in all ten data tables (only `schema_migrations` has 2), and `cas/blobs`, `cas/
 * manifests` and `dead-letter/` are empty directories. Computing "adapter failure rate" over zero
 * runs yields `0 failures / 0 attempts`, which renders as a perfect score.
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
const storeRoot = path.join(repoRoot, ".var/calllint-adoption-index")

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
// Measures 4–7 — the runtime measures, REFUSED.
//
// Each names the store it needs and what would populate it, so the refusal is an instruction rather
// than a complaint. `countRows` is deliberately NOT implemented against SQLite here: opening the
// database would require `better-sqlite3` in this script's graph (pinned 12.9.0 for an ABI cliff)
// to establish something the directory listing already establishes — that no compiler run has left
// anything behind. If a run ever does, the refusal messages below name the tables to read.
//---------------------------------------------------------------------------------------------------
function dirPopulated(p: string): { readonly exists: boolean; readonly count: number } {
  const full = path.join(storeRoot, p)
  if (!existsSync(full)) return { exists: false, count: 0 }
  try {
    return { exists: true, count: readdirSync(full).length }
  } catch {
    return { exists: false, count: 0 }
  }
}

const casBlobs = dirPopulated("cas/blobs")
const casManifests = dirPopulated("cas/manifests")
const deadLetter = dirPopulated("dead-letter")
const reports = dirPopulated("reports")
const dbFile = path.join(storeRoot, "db/adoption-index.sqlite")
const dbBytes = existsSync(dbFile) ? statSync(dbFile).size : 0

const storeHint =
  `the rolling compiler has not run against this checkout — ` +
  `${rel(storeRoot)}: cas/blobs=${casBlobs.count}, cas/manifests=${casManifests.count}, ` +
  `dead-letter=${deadLetter.count}, reports=${reports.count}, db=${dbBytes}B. ` +
  `Populate via the R-9 worker/controller, then read \`compiler_runs\` / \`compiler_jobs\``

refused(
  "adapter-failure-rate",
  `no adapter attempt has been recorded, so a rate would read 0 failures / 0 attempts — ${storeHint}`,
)
refused(
  "processing-time-mean-p95",
  `no job has a recorded start/finish, so mean and p95 would be computed over an empty set — ${storeHint}`,
)
refused(
  "cas-dedup-rate",
  `cas/blobs holds ${casBlobs.count} blob(s) and cas/manifests ${casManifests.count} manifest(s), so a dedup rate has no denominator — ${storeHint}`,
)
refused(
  "disk-growth",
  `disk growth needs two measurements over time and there is no baseline recorded — ${storeHint}`,
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
