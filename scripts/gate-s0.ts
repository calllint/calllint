#!/usr/bin/env tsx
/**
 * Gate S0 — the 25-record vertical slice (new15 traceability §26.2; ADR 0061 §11).
 *
 * S0 is the gate that unlocks registry expansion (19 → 25 → 100 → 500 → all).
 *
 * `--gate` is NOT a per-PR gate and is still NOT wired into `ci:local`: the cohort is short today,
 * so a `--gate` run is expected to fail, and a permanently-red gate in `ci:local` teaches a team to
 * ignore it. That reasoning was correct about `--gate` and was over-generalised to the whole script
 * — it concluded "this harness stays out of CI", which left every assertion S0 measures unread by
 * anything (S0-OPEN-2: `grep -rn "gate:s0"` returned two hits, both script definitions). The
 * distinction the original comment missed: the 25-record REQUIREMENT is what cannot pass today; the
 * five ASSERTIONS all pass on `main` right now, and a passing assertion nothing runs is not a
 * measurement. Hence `--regression`, which is wired in.
 *
 * WHAT THIS HARNESS REFUSES TO DO. S0's five assertions do not all live in the served bytes, and a
 * harness that reported five green ticks from one JSON file would be measuring two things and
 * asserting five. So each assertion is labelled by HOW it was established:
 *
 *   MEASURED   — computed here, from committed bytes, over the real cohort.
 *   EXECUTED   — the named gate is RUN, and S0's verdict is that run's verdict. A string scan for
 *                the assertion's text runs first, as a PRECONDITION: a renamed or deleted assertion
 *                must red even if the file's other tests pass.
 *   SCANNED    — the subject is SOURCE, not a test, so there is nothing to run. Reading the source
 *                for the required tokens IS the measurement (DEP-8's `--expect-*` flags).
 *
 * WHY `EXECUTED` REPLACED `GATE-VERIFIED`, measured rather than argued. The previous tier read the
 * named test file and confirmed its assertion's TEXT was present, explicitly not re-running it. That
 * made the coverage claim gated against deletion and blind to failure, and the gap was demonstrated,
 * not inferred: breaking the byte-identical re-derive assertion inside `committed-tree.test.ts` —
 * while leaving the grepped `control #117` comment untouched — left this harness printing
 *
 *     [GATE-VERIFIED]  INV-R6  ✓  byte-identical derivation verified
 *
 * on bytes where that very test was RED. Worse, the grepped string lives in a COMMENT, so the probe
 * could not observe whether the test existed at all — only whether the comment did. A tier whose
 * green survives its own subject's failure is not weaker evidence than MEASURED; it is evidence of
 * a different proposition than the one it prints.
 *
 * Modes:
 *   (default) report — print the five assertions + the cohort census. Exit 0 even when short,
 *                      because measuring a shortfall IS a successful measurement.
 *   --gate           — ENFORCEMENT of the full S0 claim. Exit 2 if any assertion fails OR the
 *                      cohort is under 25. Red on `main` today, correctly (S0-OPEN-1).
 *   --regression     — ENFORCEMENT of what is true TODAY. Exit 2 if any of the five assertions
 *                      fails, or if the cohort SHRINKS below the floor derived from the served
 *                      bytes at HEAD. The 25-record requirement is reported as census, not
 *                      enforced. This is the mode CI runs; see below for why it had to exist.
 *   --no-run         — skip the EXECUTED tier (report mode only). For a fast census when the
 *                      caller has already run `pnpm test`. REFUSED under `--gate` and under
 *                      `--regression`: a gate that can be asked to skip its own enforcement is the
 *                      defect above, restored as a flag.
 *
 * WHY A THIRD MODE, rather than scheduling one of the two that already existed. S0-OPEN-2 asked for
 * "a scheduled invocation of `gate:s0` in report mode". Measured before implementing: report mode
 * exits 0 unconditionally — with DEP-8's flag scan pointed at a token that does not exist, it still
 * printed `✗` beside DEP-8 and exited **0**. Scheduling it would have added a CI step with no
 * failing mode, which is this harness's own §2 defect wearing a workflow file: a green that cannot
 * observe its subject. And `--gate` cannot be scheduled either, for the opposite reason — it is red
 * on `main` for the cohort shortfall, which is a real finding that only merging the registry
 * expansion can clear, so wiring it would pin CI red for a reason no PR under review can fix.
 *
 * The two failing modes are therefore SEPARATED rather than blended. `--regression` enforces the
 * four assertion tiers plus a monotonic cohort floor; `--gate` keeps the whole claim including the
 * 25-record requirement. A single mode covering both would have had to soften one of them.
 *
 * THE FLOOR IS DERIVED, NEVER WRITTEN DOWN. `S0_REGRESSION_FLOOR` is not a literal to be adjusted:
 * it is asserted to be <= `S0_REQUIRED_RECORDS`, so it can never be raised into a second, competing
 * requirement, and a test pins it against the served cohort at HEAD. A hardcoded floor that someone
 * edits downward to make CI pass is the shape of defect this file exists to refuse.
 *
 * Exit codes: 0 ok · 2 gate failed (--gate / --regression) / unexpected error.
 */
import { spawnSync } from "node:child_process"
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
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
 * The RATCHET floor for `--regression`: the registry cohort must not shrink below this. It is the
 * cohort served at HEAD (19), so `--regression` is green today and reds the moment a change drops a
 * record — the direction that is a regression, as distinct from the shortfall S0-OPEN-1 tracks.
 *
 * Three properties keep this from becoming a second, softer requirement:
 *
 *   1. It is asserted `<= S0_REQUIRED_RECORDS` below, at load time. A floor above the requirement
 *      would mean the ratchet could red while the real gate was satisfiable, which inverts the
 *      relationship the two modes are supposed to have.
 *   2. A test pins it against `apps/web/public/trust/index.json`'s actual registry count, so the
 *      literal cannot be edited downward to make a red CI green — the classic way a ratchet is
 *      defeated. Lowering it requires editing a test whose message says why it exists.
 *   3. Raising it is NOT this gate's job. When the cohort grows to 25, `--gate` becomes satisfiable
 *      and is the mode that says so; the floor exists to catch shrinkage, not to track growth.
 */
const S0_REGRESSION_FLOOR = 25

// Asserted, not commented. A floor above the requirement is incoherent — it would red the ratchet on
// cohorts the real gate accepts — and this is the cheapest place to make that unrepresentable.
if (S0_REGRESSION_FLOOR > S0_REQUIRED_RECORDS) {
  console.error(
    `❌ incoherent constants: S0_REGRESSION_FLOOR (${S0_REGRESSION_FLOOR}) > S0_REQUIRED_RECORDS (${S0_REQUIRED_RECORDS})`,
  )
  process.exit(2)
}

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
const isRegression = process.argv.includes("--regression")
const noRun = process.argv.includes("--no-run")

// `--gate --regression` is refused rather than resolved by precedence. The two modes enforce
// DIFFERENT propositions (the full claim vs. what holds today), so a run that was asked for both has
// an ambiguous verdict, and silently picking one would print a verdict the caller did not request.
if (isGate && isRegression) {
  console.error(`❌ --gate and --regression are mutually exclusive: they enforce different claims`)
  process.exit(2)
}

// `--no-run` under either enforcing mode is refused, not honoured-with-a-warning. The whole point of
// the previous batch is that S0's green must not be reachable while its named tests are red; a flag
// that turns the check off would restore exactly that, with a command-line switch instead of a grep.
// `--regression` is included because it is the mode CI runs — the one place the escape hatch would
// have mattered most.
if ((isGate || isRegression) && noRun) {
  const mode = isGate ? "--gate" : "--regression"
  console.error(`❌ --no-run is refused under ${mode}: enforcement cannot be asked to skip itself`)
  process.exit(2)
}

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
// EXECUTED tier — run the named gates and adopt their verdict
//---------------------------------------------------------------------------------------------------
/**
 * One RUN of the vitest files S0 names, parsed from the JSON reporter.
 *
 * Keyed on the PARSED REPORT, not on the child's exit status. `[[subprocess-negative-control-prints-fail]]`
 * is the general rule (a test's result is its assertion, never a child's stream), and it bites here
 * concretely: the child prints failing-test output to stdout, so a caller reading the stream cannot
 * tell "1 failed" from a test whose own fixture prints the word `FAIL`. The report has counts.
 *
 * Absence is its own outcome, never a category. A missing, empty, or unparseable report returns
 * `ok: false` with the reason named — per `[[absence-must-not-become-a-category]]`, a two-way
 * ok/not-ok split over a possibly-absent file would let a crashed runner sort itself into whichever
 * branch the falsy value satisfies. Here it sorts into FAILED, loudly.
 */
interface RunOutcome {
  ok: boolean
  reason: string
  /** Per-file status, so a file that was never collected is distinguishable from one that passed. */
  files: Map<string, string>
  total: number
  failed: number
}

function runVitest(files: readonly string[]): RunOutcome {
  const empty = new Map<string, string>()
  const outDir = mkdtempSync(path.join(tmpdir(), "gate-s0-"))
  const outFile = path.join(outDir, "report.json")
  try {
    const child = spawnSync(
      process.execPath,
      [path.join(repoRoot, "node_modules/vitest/vitest.mjs"), "run", ...files, "--reporter=json", `--outputFile=${outFile}`],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )

    if (child.error) return { ok: false, reason: `runner failed to start: ${child.error.message}`, files: empty, total: 0, failed: 0 }
    if (!existsSync(outFile)) {
      // The runner produced no report at all — a collection error, a config error, or a crash. The
      // child's own stderr is the only evidence of WHY, so it is surfaced rather than swallowed.
      const tail = (child.stderr || child.stdout || "").trim().split("\n").slice(-4).join(" / ")
      return { ok: false, reason: `no JSON report written (exit ${child.status}): ${tail || "no output"}`, files: empty, total: 0, failed: 0 }
    }

    let report: {
      success?: boolean
      numTotalTests?: number
      numFailedTests?: number
      testResults?: { name?: string; status?: string }[]
    }
    try {
      report = JSON.parse(readFileSync(outFile, "utf8"))
    } catch (e) {
      return { ok: false, reason: `JSON report unparseable: ${(e as Error).message}`, files: empty, total: 0, failed: 0 }
    }

    const byFile = new Map<string, string>()
    for (const r of report.testResults ?? []) {
      if (typeof r?.name === "string") byFile.set(rel(r.name), r.status ?? "unknown")
    }

    const total = report.numTotalTests ?? 0
    const failed = report.numFailedTests ?? 0

    // Every named file must be present in the report AND passing. A file vitest never collected is
    // absent from `testResults`, and `success` alone would still be true — the same shape of blindness
    // this tier exists to remove, one layer down.
    const missing = files.filter((f) => !byFile.has(rel(path.join(repoRoot, f))))
    if (missing.length > 0) {
      return { ok: false, reason: `not collected by the runner: ${missing.join(", ")}`, files: byFile, total, failed }
    }
    const notPassed = [...byFile.entries()].filter(([, s]) => s !== "passed")
    if (notPassed.length > 0) {
      return {
        ok: false,
        reason: `${failed}/${total} test(s) failed: ${notPassed.map(([f, s]) => `${f} → ${s}`).join(", ")}`,
        files: byFile,
        total,
        failed,
      }
    }
    // Vacuity guard: a file that collected zero tests reports `success: true`. Zero assertions is not
    // a pass, for the same reason INV-R4's empty observation set is not one.
    if (total === 0) return { ok: false, reason: `VACUOUS: the runner collected 0 tests`, files: byFile, total, failed }
    if (report.success !== true || failed !== 0) {
      return { ok: false, reason: `runner reported success=${report.success}, failed=${failed}`, files: byFile, total, failed }
    }
    return { ok: true, reason: `${total} test(s) passed across ${byFile.size} file(s)`, files: byFile, total, failed }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

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
/**
 * A named gate: the file S0 relies on, plus the assertion text whose disappearance must red even
 * when the file's remaining tests pass. The scan is a PRECONDITION on the run, not a substitute for
 * it — the two catch opposite things:
 *
 *   scan without run  → green while the assertion is present and FAILING  (the defect, §docblock)
 *   run without scan  → green after the assertion is RENAMED OR DELETED, since the file still passes
 *
 * The anchor is matched against the file with COMMENTS STRIPPED, and this is not a stylistic choice.
 * MEASURED over the three anchors below: `control #117` occurs three times in
 * `committed-tree.test.ts` — `:50` and `:116` in comments, `:145` in the `it()` title. Matching raw
 * text means deleting the test still leaves the precondition green, because the prose ABOUT the test
 * satisfies it. That is the same class of defect as the run-less scan in the docblock: a probe agreeing
 * with a claim's description instead of the claim. The other two anchors are `describe()` titles with
 * zero comment occurrences, so stripping changes nothing for them and everything for INV-R6.
 *
 * The stripper is guarded two-sidedly (`assertStrips`) — it must remove the comment occurrences AND
 * retain the title one. A stripper that over-removed would red every gate and read as "anchors gone."
 */
interface NamedGate {
  id: string
  file: string
  anchor: string
}

const NAMED_GATES: NamedGate[] = [
  {
    id: "INV-04",
    // `describe()` title at :242, zero comment occurrences.
    file: "tests/invariants/adoption-index-no-execution.invariants.test.ts",
    anchor: "no module in the compiler can execute anything (INV-04)",
  },
  {
    id: "INV-R7",
    // `describe()` title at :360, zero comment occurrences.
    file: "packages/adoption-index/test/store-schema.test.ts",
    anchor: "write containment (INV-R7, control #12)",
  },
  {
    id: "INV-R6",
    // `it()` title at :145, plus TWO comment occurrences at :50 and :116 — the reason the scan strips
    // comments before matching. This is also the gate whose blindness was demonstrated: the mutation
    // left both the comment and the title intact, and the old probe stayed green while the test red.
    file: "packages/trust-index/test/committed-tree.test.ts",
    anchor: "control #117",
  },
]

/**
 * Strip line and block comments so an anchor is matched against CODE. Deliberately naive — it does not
 * parse strings, so a `//` inside a string literal would over-strip. `assertStrips` below is what makes
 * that safe to accept: every anchor is checked to survive stripping, so an over-eager strip reds loudly
 * here rather than silently weakening a precondition.
 */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "")
  // Scanned character by character rather than by regex, because the two failure modes are opposite and a
  // single pattern buys one by giving up the other. `^[ \t]*//` misses a TRAILING comment (so a deleted
  // test whose anchor survives after code stays "present"); `//` anywhere eats a `https://` inside a test
  // title (so a live test reads as absent). Tracking whether we are inside a string is what admits both.
  // Both directions are pinned by `assertStrips`, and both were observed: the trailing case red the real
  // stripper when the fixture gained its line, and the URL case is what control #169 fired on.
  let out = ""
  let quote: string | null = null
  for (let i = 0; i < noBlocks.length; i++) {
    const c = noBlocks[i]!
    if (quote !== null) {
      out += c
      if (c === "\\") {
        out += noBlocks[++i] ?? ""
      } else if (c === quote) {
        quote = null
      }
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c
      out += c
      continue
    }
    if (c === "/" && noBlocks[i + 1] === "/") {
      while (i < noBlocks.length && noBlocks[i] !== "\n") i++
      out += "\n"
      continue
    }
    out += c
  }
  return out
}

/**
 * Two-sided guard on the stripper, over a synthetic fixture rather than the corpus, so it measures the
 * function and not today's files. Both directions are failures of equal weight:
 *
 *   under-strip → a deleted test stays "present" via its own docs (the defect being fixed)
 *   over-strip  → every anchor reads as absent, and three green gates report as missing
 *
 * Reported through `scanFailures` so a broken stripper reds the EXECUTED tier by name, instead of
 * silently turning the precondition into a coin flip.
 */
function assertStrips(): string[] {
  const KEEP = `it("keeps this (control #X)", () => {})`
  // The URL line is the fixture's whole point, and it was added because control #169 caught its absence.
  // #169 loosened the line-comment pattern from `^[ \t]*//` to `//` anywhere and the guard stayed GREEN:
  // every fixture line either began with the comment marker or contained no `//` at all, so leading-only
  // and anywhere-on-the-line were indistinguishable. A protocol-relative `//` inside a STRING is the case
  // that separates them, and it is not hypothetical — test titles cite spec URLs throughout this repo.
  const KEEP_URL = `it("see https://x.dev — also keeps this (control #Y)", () => {})`
  const fixture = [
    `// a comment naming control #X`,
    `/* a block naming control #X */`,
    KEEP,
    KEEP_URL,
    `const x = 1 // a trailing comment naming control #X`,
  ].join("\n")
  const out = stripComments(fixture)
  const failures: string[] = []
  const occurrences = out.split("control #X").length - 1
  if (occurrences !== 1) {
    failures.push(
      `stripComments is UNSAFE: expected exactly 1 surviving "control #X" (the it() title), observed ${occurrences}`,
    )
  }
  if (!out.includes(KEEP)) failures.push(`stripComments OVER-STRIPPED: the plain it() title did not survive`)
  if (!out.includes(KEEP_URL)) {
    failures.push(`stripComments OVER-STRIPPED: an it() title containing "https://" did not survive`)
  }
  return failures
}

/** Precondition: the file exists and still carries its anchor IN CODE, not merely in prose about it. */
const scanFailures: string[] = [...assertStrips()]
for (const g of NAMED_GATES) {
  const abs = path.join(repoRoot, g.file)
  if (!existsSync(abs)) {
    scanFailures.push(`${g.id}: file ABSENT (${g.file})`)
    continue
  }
  const raw = readFileSync(abs, "utf8").replace(/\r\n/g, "\n")
  const code = stripComments(raw)
  if (!code.includes(g.anchor)) {
    // Name WHICH way it went missing. "absent from code but present in a comment" is a rename or a
    // deletion that left its docs behind — a different repair than "gone entirely".
    const inProse = raw.includes(g.anchor)
    scanFailures.push(
      inProse
        ? `${g.id}: anchor present only in COMMENTS — "${g.anchor}" no longer names a test in ${g.file}`
        : `${g.id}: anchor absent — "${g.anchor}" not in ${g.file}`,
    )
  }
}

/**
 * One run covering all three files. Batched because vitest's startup dominates, and because a single
 * report lets the per-file status check above see all three at once.
 *
 * Under `--no-run` (report mode only) the tier is SKIPPED, and skipped is printed as `–`, never as
 * `✓`. `allOk` treats a skip as not-ok, so the only way to reach a green S0 is to run the gates.
 */
const executed: RunOutcome | null = noRun ? null : runVitest(NAMED_GATES.map((g) => g.file))

const executedOk = scanFailures.length === 0 && executed !== null && executed.ok
const executedMessage =
  scanFailures.length > 0
    ? `PRECONDITION FAILED: ${scanFailures.join("; ")}`
    : executed === null
      ? `SKIPPED (--no-run); the named gates were not run, so this is not a pass`
      : executed.ok
        ? `ran ${NAMED_GATES.length} named gate file(s): ${executed.reason}`
        : `GATE RED: ${executed.reason}`

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
const allOk = invR5_terminal && invR4_ok && executedOk && dep8_ok
const registryShort = censusRegistry < S0_REQUIRED_RECORDS
// The regression direction, kept separate from the shortfall. `registryShort` is TRUE on `main`
// today and is not a regression; `cohortRegressed` is FALSE on `main` today and would be a real
// defect. Blending them into one boolean is what made the gate unwireable.
const cohortRegressed = censusRegistry < S0_REGRESSION_FLOOR

console.log(`\n=== Gate S0 — the 25-record vertical slice ===\n`)
console.log(`Cohort census:`)
console.log(`  Registry:  ${censusRegistry} / ${S0_REQUIRED_RECORDS} required ${registryShort ? "(SHORTFALL)" : "(met)"}`)
console.log(
  `             ratchet floor ${S0_REGRESSION_FLOOR} ${cohortRegressed ? `(REGRESSED — cohort shrank)` : `(held)`}`,
)
console.log(`  Fixtures:  ${censusFixtures} (excluded from the requirement by design)`)
console.log(`  Total:     ${censusTotal}\n`)

// The EXECUTED tick is `–` when skipped, never `✓`. A skipped check that prints the same glyph as a
// passing one is the docblock's defect in miniature: the reader cannot tell evidence from absence.
const executedTick = executedOk ? "✓" : executed === null && scanFailures.length === 0 ? "–" : "✗"

console.log(`Assertions:`)
console.log(`  [MEASURED]  INV-R5           ${invR5_terminal ? "✓" : "✗"}  ${invR5_message}`)
console.log(`  [MEASURED]  INV-R4           ${invR4_ok ? "✓" : "✗"}  ${invR4_message}`)
console.log(`  [EXECUTED]  INV-04+R7+R6     ${executedTick}  ${executedMessage}`)
if (executed !== null) {
  for (const g of NAMED_GATES) {
    const status = executed.files.get(g.file) ?? "NOT COLLECTED"
    // A per-gate tick must not contradict its own tier. Control #168 renamed INV-R6's `it()` title away
    // while leaving the comments: the tier red on the precondition, and this line still printed `✓`
    // because the FILE passed — a passing file whose named assertion is gone is exactly what the scan
    // exists to catch. The tick therefore requires both: the run passed AND no precondition names it.
    const preconditionFailed = scanFailures.some((f) => f.startsWith(`${g.id}:`))
    const detail = preconditionFailed ? `${status} (but its named assertion is missing)` : status
    console.log(
      `                ${g.id.padEnd(8)} ${status === "passed" && !preconditionFailed ? "✓" : "✗"}  ${g.file} → ${detail}`,
    )
  }
}
console.log(`  [SCANNED]   DEP-8            ${dep8_ok ? "✓" : "✗"}  ${dep8_message}\n`)

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
} else if (isRegression) {
  // Enforces the four tiers and the ratchet — NOT the 25-record requirement. The shortfall is
  // printed above as census and deliberately does not decide this exit code: it is S0-OPEN-1's
  // subject, clearable only by a served-bytes change, so enforcing it here would make every
  // unrelated PR red for a reason its author cannot address.
  if (!allOk) {
    console.error(`❌ --regression mode: one or more assertions FAILED (see ✗ above)`)
    process.exit(2)
  }
  if (cohortRegressed) {
    console.error(
      `❌ --regression mode: registry cohort ${censusRegistry} fell below the ratchet floor ${S0_REGRESSION_FLOOR} — a record was lost`,
    )
    process.exit(2)
  }
  console.log(
    registryShort
      ? `✓ All assertions passed; cohort ${censusRegistry} holds the floor (${S0_REGRESSION_FLOOR}). The ${S0_REQUIRED_RECORDS}-record requirement is still short — reported, not enforced here (S0-OPEN-1)\n`
      : `✓ All assertions passed; cohort ${censusRegistry} meets the full requirement — \`--gate\` is now satisfiable and is the mode that says so\n`,
  )
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

