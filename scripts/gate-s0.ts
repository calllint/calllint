#!/usr/bin/env tsx
/**
 * Gate S0 — the 25-record vertical slice (new15 traceability §26.2; ADR 0061 §11).
 *
 * S0 is the gate that unlocks registry expansion (19 → 25 → 100 → 500 → all). It is NOT a per-PR
 * gate, and it is deliberately NOT wired into `ci:local`: the cohort is short today, so a `--gate`
 * run is expected to fail, and a permanently-red gate in `ci:local` teaches a team to ignore it.
 *
 * WHAT THIS HARNESS REFUSES TO DO. S0's five assertions do not all live in the served bytes, and a
 * harness that reported five green ticks from one JSON file would be measuring two things and
 * asserting five. So each assertion is labelled by HOW it was established:
 *
 *   MEASURED       — computed here, from committed bytes, over the real cohort.
 *   GATE-VERIFIED  — not computable from `index.json`; instead the named gate is READ and its
 *                    assertion confirmed present. This is the prose-justified-constant lesson
 *                    applied to coverage claims: a doc sentence saying "INV-R6 is covered by
 *                    committed-tree.test.ts" is a claim about a second file that nothing checks, so
 *                    deleting that gate would leave the sentence green. Parsing the file makes the
 *                    coverage claim itself gated — a deleted or renamed gate fails S0.
 *
 * GATE-VERIFIED is weaker than MEASURED and is not presented as its equal. It proves the gate exists
 * and still asserts what S0 relies on; it does not re-run it. `pnpm test` runs it.
 *
 * Modes:
 *   (default) report — print the five assertions + the cohort census. Exit 0 even when short,
 *                      because measuring a shortfall IS a successful measurement.
 *   --gate           — ENFORCEMENT. Exit 2 if any assertion fails OR the cohort is under 25.
 *
 * Exit codes: 0 ok · 2 gate failed (--gate) / unexpected error.
 */
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { fixtureCohort } from "../packages/trust-index/src/cohort.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const rel = (p: string): string => path.relative(repoRoot, p).replace(/\\/g, "/")

/**
 * The record floor S0 names. 25 is the vertical slice's size in traceability §26.2 — a REQUIREMENT,
 * not a cap, stated here so a short cohort is reported as a shortfall rather than silently rescaled
 * to whatever happens to be committed.
 */
const S0_REQUIRED_RECORDS = 25

/**
 * Fixtures are excluded from the S0 count on purpose. They are golden inputs authored by this repo,
 * so counting them toward a slice of REAL upstream subjects would let the gate be satisfied by
 * writing more fixtures — the cohort would grow while upstream coverage stayed flat.
 */
const FIXTURE_PREFIX = "calllint-fixtures/"
const REGISTRY_PREFIX = "mcp-registry/"

//---------------------------------------------------------------------------------------------------
// CLI
//---------------------------------------------------------------------------------------------------
const isGate = process.argv.includes("--gate")

//---------------------------------------------------------------------------------------------------
// Load the cohort
//---------------------------------------------------------------------------------------------------
const indexPath = path.join(repoRoot, "apps/web/public/trust/index.json")
if (!existsSync(indexPath)) {
  console.error(`❌ ${rel(indexPath)} not found`)
  process.exit(2)
}

interface AdoptionPage {
  canonicalName: string
  status: string
  /** Null on an `incomplete` entry — no page was baked, so there is nothing to digest or judge. */
  artifactDigest: string | null
  pageDigest: string | null
  verdict: string | null
  observedAt: string
  /**
   * Both axes ride on the ENTRY, not on a `<canonicalName>.json` sidecar — the S-3 finding, measured
   * as 38/38 on the entry and 0 in sidecars. An earlier draft of this harness read a sidecar path
   * that does not exist (`<canonicalName>/index.json`), so `existsSync` was false 39/39 times, the
   * loop `continue`d every iteration, and INV-R4 reported "0 dangerous" as a PASS from zero
   * observations. Hence the vacuity guard below: an assertion over an empty set is not a pass.
   */
  freshness?: { ageDays: number | null; state: string; cadenceDays: number; basis: string }
  resolution?: { status: string; basis: string[]; blockingUnknowns: string[]; cadenceDays: number }
}

interface AdoptionIndex {
  schema: string
  cohorts: string[]
  bakedAt: string
  baked: number
  incomplete: number
  entries: AdoptionPage[]
}

const raw = readFileSync(indexPath, "utf8")
const index: AdoptionIndex = JSON.parse(raw)

const allPages = index.entries
const fixtures = allPages.filter((p) => p.canonicalName.startsWith(FIXTURE_PREFIX))
const registry = allPages.filter((p) => p.canonicalName.startsWith(REGISTRY_PREFIX))

const censusRegistry = registry.length
const censusFixtures = fixtures.length
const censusTotal = allPages.length

//---------------------------------------------------------------------------------------------------
// Measure what is computable from index.json
//---------------------------------------------------------------------------------------------------
// INV-R5: every entry carries a terminal lifecycle status (`baked` or `incomplete`), and no source
// record vanished. The latter cannot be tested by reading index.json alone — a vanished record is
// ABSENT — so it is measured by reconciliation against the two INPUT sources: every source record
// must appear in the served index under some terminal status.
//
// The expected total is DERIVED from those sources, never written down. An earlier draft hardcoded
// `19 + 20`, which is the very defect this harness's docblock claims to defend against: the numbers
// are a claim about two other files, and nothing read them. It also made the gate unpassable — when
// upstream grows to 25 the served total becomes 45 while the constant stays 39, so INV-R5 would red
// for the wrong reason at exactly the moment S0 was finally satisfiable.
const snapshotPath = path.join(repoRoot, "packages/trust-index/snapshots/official-mcp-registry.json")
if (!existsSync(snapshotPath)) {
  console.error(`❌ ${rel(snapshotPath)} not found — INV-R5 cannot reconcile without its source`)
  process.exit(2)
}
const snapshot: { entries: unknown[] } = JSON.parse(readFileSync(snapshotPath, "utf8"))
const sourceRegistry = snapshot.entries.length
const sourceFixtures = fixtureCohort().length
const expectedTotal = sourceRegistry + sourceFixtures
const bakedCount = allPages.filter((p) => p.status === "baked").length
const incompleteCount = allPages.filter((p) => p.status === "incomplete").length
const invR5_terminal = bakedCount + incompleteCount === expectedTotal && censusTotal === expectedTotal
const invR5_message = invR5_terminal
  ? `every entry carries a terminal status (baked ${bakedCount}, incomplete ${incompleteCount}); reconciles ${censusTotal} = ${sourceRegistry} snapshot + ${sourceFixtures} fixtures`
  : `MISMATCH: baked ${bakedCount} + incomplete ${incompleteCount} vs sources ${sourceRegistry} snapshot + ${sourceFixtures} fixtures = ${expectedTotal}; served total ${censusTotal}`

// INV-R4: a SAFE verdict with `resolution.status === "UNKNOWN"` is legitimate only when
// `freshness.basis === "fixture-anchor"`. The fixture's epoch anchor is NOT an observation, so
// SAFE+UNKNOWN+fixture-anchor is correct. SAFE+UNKNOWN with any other basis is dangerous.
//
// Measurement reads the ENTRY, not a sidecar (see the interface note below). Fixtures are excluded
// from the record COUNT (above) but NOT from the invariant — a defective fixture is still a defect.
const safeUnknownLegitimate: AdoptionPage[] = []
const safeUnknownDangerous: AdoptionPage[] = []
const observed: AdoptionPage[] = []
/**
 * Entries that carry neither axis. An `incomplete` entry legitimately has none — no page was baked,
 * `verdict` is null, so it lies OUTSIDE INV-R4's domain (a null verdict cannot be SAFE). But the
 * exclusion is asserted by SET EQUALITY against the incomplete entries, not by subtracting a count:
 * a subtraction would let a BAKED entry that lost its `freshness` shrink the denominator to 37 and
 * still report a clean pass, which is the same absence-shaped defect one layer down.
 */
const unjudgeable: AdoptionPage[] = []

for (const page of allPages) {
  if (page.freshness === undefined || page.resolution === undefined) {
    unjudgeable.push(page)
    continue
  }
  observed.push(page)

  if (page.verdict === "SAFE" && page.resolution.status === "UNKNOWN") {
    if (page.freshness.basis === "fixture-anchor") {
      safeUnknownLegitimate.push(page)
    } else {
      safeUnknownDangerous.push(page)
    }
  }
}

const incompleteNames = allPages.filter((p) => p.status === "incomplete").map((p) => p.canonicalName).sort()
const unjudgeableNames = unjudgeable.map((p) => p.canonicalName).sort()
const domainIntact = JSON.stringify(unjudgeableNames) === JSON.stringify(incompleteNames)

// Vacuity guard: an empty observation set is a broken probe, not a clean cohort.
const invR4_ok = domainIntact && observed.length > 0 && safeUnknownDangerous.length === 0
const invR4_message = !domainIntact
  ? `DOMAIN BREACH: entries lacking freshness/resolution [${unjudgeableNames.join(", ")}] ≠ incomplete entries [${incompleteNames.join(", ")}] — a baked entry went unmeasured`
  : observed.length === 0
    ? `VACUOUS: 0 entries carried both axes, so the invariant was never evaluated`
    : safeUnknownDangerous.length === 0
      ? `${observed.length}/${censusTotal} judgeable (${unjudgeable.length} incomplete, outside the domain); SAFE+UNKNOWN found ${safeUnknownLegitimate.length}, all fixture-anchor (legitimate)`
      : `DANGEROUS: ${safeUnknownDangerous.length} SAFE+UNKNOWN entry(ies) without fixture-anchor: ${safeUnknownDangerous.map((p) => p.canonicalName).join(", ")}`

//---------------------------------------------------------------------------------------------------
// Verify gates by source scan (prose-justified-constant pattern)
//---------------------------------------------------------------------------------------------------
// S0's "0 hidden persistent installs" has TWO layers, and verifying one would report half an
// assertion as a whole one. A hidden install requires both executing an installer AND persisting
// its output, so each layer is anchored separately:
//   INV-04  — no compiler module can execute anything at all (the stronger claim: nothing to hide)
//   INV-R7  — nothing persists outside `.var/calllint-adoption-index/` (the containment backstop)
// Naming them separately also means deleting either gate reds S0, rather than the surviving one
// covering for the deleted one.
const inv04_gate = path.join(repoRoot, "tests/invariants/adoption-index-no-execution.invariants.test.ts")
const inv04_ok =
  existsSync(inv04_gate) &&
  readFileSync(inv04_gate, "utf8").includes("no module in the compiler can execute anything (INV-04)")

const containment_gate = path.join(repoRoot, "packages/adoption-index/test/store-schema.test.ts")
const containment_ok =
  existsSync(containment_gate) &&
  readFileSync(containment_gate, "utf8").includes("write containment (INV-R7, control #12)")

const invR7_ok = inv04_ok && containment_ok
const invR7_message = invR7_ok
  ? `no-execution (INV-04) + write containment (INV-R7) both verified`
  : `MISSING: no-execution ${inv04_ok ? "ok" : `ABSENT (${rel(inv04_gate)})`}; containment ${containment_ok ? "ok" : `ABSENT (${rel(containment_gate)})`}`

// INV-R6: the committed adoption-index.json is byte-identical to what the committed snapshot derives.
// Gate: packages/trust-index/test/committed-tree.test.ts, control #117
const invR6_gate = path.join(repoRoot, "packages/trust-index/test/committed-tree.test.ts")
const invR6_ok = existsSync(invR6_gate) && readFileSync(invR6_gate, "utf8").includes('control #117')
const invR6_message = invR6_ok
  ? `byte-identical derivation verified (${rel(invR6_gate)})`
  : `MISSING: gate not found or control #117 absent (${rel(invR6_gate)})`

// DEP-8: the CLI verifies artifact digest + version + contract digest.
// Gate: apps/cli/src/commands/trust.ts, the three --expect-* flags
const dep8_gate = path.join(repoRoot, "apps/cli/src/commands/trust.ts")
const dep8_src = existsSync(dep8_gate) ? readFileSync(dep8_gate, "utf8") : ""
const dep8_hasArtifact = dep8_src.includes("--expect-artifact-digest")
const dep8_hasVersion = dep8_src.includes("--expect-version")
const dep8_hasContract = dep8_src.includes("--expect-contract-digest")
const dep8_ok = dep8_hasArtifact && dep8_hasVersion && dep8_hasContract
const dep8_message = dep8_ok
  ? `CLI verification flags present (${rel(dep8_gate)})`
  : `MISSING: one or more --expect-* flags absent (artifact: ${dep8_hasArtifact}, version: ${dep8_hasVersion}, contract: ${dep8_hasContract})`

//---------------------------------------------------------------------------------------------------
// Report
//---------------------------------------------------------------------------------------------------
const allOk = invR5_terminal && invR4_ok && invR7_ok && invR6_ok && dep8_ok
const registryShort = censusRegistry < S0_REQUIRED_RECORDS

console.log(`\n=== Gate S0 — the 25-record vertical slice ===\n`)
console.log(`Cohort census:`)
console.log(`  Registry:  ${censusRegistry} / ${S0_REQUIRED_RECORDS} required ${registryShort ? "(SHORTFALL)" : "(met)"}`)
console.log(`  Fixtures:  ${censusFixtures} (excluded from the requirement by design)`)
console.log(`  Total:     ${censusTotal}\n`)

console.log(`Assertions:`)
console.log(`  [MEASURED]       INV-R5     ${invR5_terminal ? "✓" : "✗"}  ${invR5_message}`)
console.log(`  [MEASURED]       INV-R4     ${invR4_ok ? "✓" : "✗"}  ${invR4_message}`)
console.log(`  [GATE-VERIFIED]  INV-04+R7  ${invR7_ok ? "✓" : "✗"}  ${invR7_message}`)
console.log(`  [GATE-VERIFIED]  INV-R6     ${invR6_ok ? "✓" : "✗"}  ${invR6_message}`)
console.log(`  [GATE-VERIFIED]  DEP-8      ${dep8_ok ? "✓" : "✗"}  ${dep8_message}\n`)

if (isGate) {
  if (!allOk) {
    console.error(`❌ --gate mode: one or more assertions FAILED`)
    process.exit(2)
  }
  if (registryShort) {
    console.error(`❌ --gate mode: registry cohort ${censusRegistry} < ${S0_REQUIRED_RECORDS} required`)
    process.exit(2)
  }
  console.log(`✓ All assertions passed, cohort meets the requirement\n`)
  process.exit(0)
} else {
  // Report mode: always exit 0. Measuring a shortfall IS a successful measurement.
  if (allOk && !registryShort) {
    console.log(`✓ All assertions passed, cohort meets the requirement\n`)
  } else {
    console.log(`⚠️  Gate S0 would fail in --gate mode (report complete)\n`)
  }
  process.exit(0)
}

