/**
 * run-report — the projection that gives `reports/` its first writer, and gate-s1 its first reader
 * with something to read.
 *
 * ## Why this file is not redundant with `job-lease.test.ts`
 *
 * That file grades `compiler_runs` — the record of truth, in SQLite. This grades the JSON
 * projection of it, which exists ONLY because `scripts/gate-s1.ts` deliberately refuses to open
 * the database (`better-sqlite3` is pinned against an ABI cliff; a gate that cannot load a native
 * module reports nothing). Two representations of one run is a drift risk, so the tests that matter
 * most here are the ones that check the projection cannot disagree with the row.
 *
 * ## The specific defect this directory had
 *
 * `reports` was declared in `INDEX_SUBDIRS` from the first commit and counted by
 * `gate-s1.ts:438` for just as long, and NOTHING ever wrote it. The census printed `reports=0`
 * on every run, indistinguishable from "no run has happened yet". This suite exists so that
 * removing the writer is a red test rather than a silent return to that state.
 *
 * Negative controls this file is the measurement for:
 *   #R1 outcome copied from the caller instead of `gradeRun` → a FAILED run reports SUCCEEDED
 *   #R2 write in place instead of staging + rename          → a reader can observe partial JSON
 *   #R3 `skippedNoAdapter` folded into failures             → a run with no adapter reads as failed
 *   #R4 a run id containing a path separator                → a write escapes the index root
 *   #R5 the writer removed entirely                         → this suite must go red, not green
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import {
  RUN_REPORT_SCHEMA,
  writeRunReport,
  reportsRoot,
  runReportPath,
  resolveIndexPaths,
  isInsideRoot,
  gradeRun,
  emptyRunMetrics,
  type RunReport,
  type CompilerRunMetrics,
} from "../src/index.js"

const temps: string[] = []
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "calllint-run-report-"))
  temps.push(dir)
  const { root, dirs } = resolveIndexPaths(dir)
  for (const d of dirs) mkdirSync(d, { recursive: true })
  return root
}
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop()!, { recursive: true, force: true })
})

/** Metrics with a distinct value per field, so a field swapped for another is visible. */
function distinctMetrics(): CompilerRunMetrics {
  return {
    sourceRecordsRead: 11,
    subjectsCompiled: 22,
    artifactsResolved: 33,
    evidenceCompiled: 44,
    recordsEmitted: 55,
    failures: 0,
  }
}

function report(over: Partial<RunReport> = {}): RunReport {
  const metrics = over.metrics ?? distinctMetrics()
  const digest = over.outputManifestDigest === undefined ? "sha256:out" : over.outputManifestDigest
  return {
    schema: RUN_REPORT_SCHEMA,
    runId: "r-0001",
    runType: "full",
    outcome: gradeRun(metrics, digest),
    startedAt: "2026-08-31T00:00:00.000Z",
    completedAt: "2026-08-31T00:01:00.000Z",
    outputManifestDigest: digest,
    inputManifestDigest: "sha256:in",
    metrics,
    attempts: { artifacts: null, evidence: null },
    ...over,
  }
}

describe("the report lands where the gate already looks", () => {
  it("writes under `reports/`, the directory `gate-s1.ts:438` counts", () => {
    const root = tempRoot()
    const written = writeRunReport(root, report())

    expect(written).toBe(runReportPath(root, "r-0001"))
    expect(resolve(written)).toBe(resolve(reportsRoot(root), "run-r-0001.json"))
    expect(readdirSync(reportsRoot(root))).toEqual(["run-r-0001.json"])
  })

  it("leaves NO staging file behind, so the gate's file count is the run count", () => {
    const root = tempRoot()
    writeRunReport(root, report({ runId: "a" }))
    writeRunReport(root, report({ runId: "b" }))

    const entries = readdirSync(reportsRoot(root))
    expect(entries.sort()).toEqual(["run-a.json", "run-b.json"])
    // The `.part` staging name must never survive. A gate that counts files would otherwise
    // report twice as many runs as happened — control #R2's observable half.
    expect(entries.some((e) => e.endsWith(".part"))).toBe(false)
  })

  it("stays inside the index root (INV-R7)", () => {
    const root = tempRoot()
    const written = writeRunReport(root, report())
    expect(isInsideRoot(root, written)).toBe(true)
  })

  it("is valid JSON a reader can parse without knowing this module", () => {
    const root = tempRoot()
    const parsed = JSON.parse(readFileSync(writeRunReport(root, report()), "utf8"))

    expect(parsed.schema).toBe("calllint.compiler-run-report.v1")
    expect(parsed.runId).toBe("r-0001")
    expect(parsed.metrics).toEqual(distinctMetrics())
  })
})

describe("the projection cannot disagree with the `compiler_runs` row", () => {
  it("grades a run with no output manifest FAILED, exactly as the row does", () => {
    const metrics = { ...distinctMetrics(), failures: 0 }
    // Note: zero failures AND no manifest. A caller reading only `failures` would call this
    // SUCCEEDED; `gradeRun` calls it FAILED because the manifest is null. Control #R1 replaces
    // the `gradeRun` call with the caller's opinion and observes exactly this row flip.
    const r = report({ metrics, outputManifestDigest: null })
    expect(r.outcome).toBe("FAILED")
    expect(gradeRun(metrics, null)).toBe("FAILED")

    const root = tempRoot()
    const parsed = JSON.parse(readFileSync(writeRunReport(root, r), "utf8"))
    expect(parsed.outcome).toBe("FAILED")
    expect(parsed.outputManifestDigest).toBeNull()
  })

  it("grades a run with failures PARTIAL, not SUCCEEDED", () => {
    const metrics = { ...distinctMetrics(), failures: 3 }
    const root = tempRoot()
    const parsed = JSON.parse(readFileSync(writeRunReport(root, report({ metrics })), "utf8"))
    expect(parsed.outcome).toBe("PARTIAL")
  })

  it("grades a clean run SUCCEEDED", () => {
    const root = tempRoot()
    const parsed = JSON.parse(readFileSync(writeRunReport(root, report()), "utf8"))
    expect(parsed.outcome).toBe("SUCCEEDED")
  })

  it("records six zeros as zeros, and NOT as an absent section", () => {
    // The empty-denominator lesson: a run that did nothing must SAY it did nothing, in numbers a
    // reader can see. Serializing zeros away (or defaulting them on read) is how "no data" starts
    // to render as a perfect score.
    const root = tempRoot()
    const parsed = JSON.parse(
      readFileSync(writeRunReport(root, report({ metrics: emptyRunMetrics() })), "utf8"),
    )
    expect(parsed.metrics).toEqual({
      sourceRecordsRead: 0,
      subjectsCompiled: 0,
      artifactsResolved: 0,
      evidenceCompiled: 0,
      recordsEmitted: 0,
      failures: 0,
    })
  })
})

describe("attempt counts arrive unaggregated, with their denominators", () => {
  it("keeps `skippedNoAdapter` separate from the failure counts (control #R3)", () => {
    const root = tempRoot()
    const parsed = JSON.parse(
      readFileSync(
        writeRunReport(
          root,
          report({
            attempts: {
              artifacts: {
                considered: 100,
                fetched: 10,
                unavailable: 2,
                rejected: 1,
                skippedNoAdapter: 87,
                cached: 0,
              },
              evidence: null,
            },
          }),
        ),
        "utf8",
      ),
    )

    // A reader computing an adapter-failure rate must be able to get 3/13 — attempts that were
    // TRIED and failed over attempts tried — and must not be able to accidentally get 90/100 by
    // treating a skip as a failure. Both numerator parts and the skip are separately addressable.
    expect(parsed.attempts.artifacts.unavailable + parsed.attempts.artifacts.rejected).toBe(3)
    expect(parsed.attempts.artifacts.skippedNoAdapter).toBe(87)
    expect(parsed.attempts.artifacts.considered).toBe(100)
  })

  it("distinguishes a stage that did not run (`null`) from one that counted zero", () => {
    const root = tempRoot()

    const notRun = JSON.parse(
      readFileSync(
        writeRunReport(root, report({ runId: "notrun", attempts: { artifacts: null, evidence: null } })),
        "utf8",
      ),
    )
    const ranEmpty = JSON.parse(
      readFileSync(
        writeRunReport(
          root,
          report({
            runId: "ranempty",
            attempts: {
              artifacts: {
                considered: 0,
                fetched: 0,
                unavailable: 0,
                rejected: 0,
                skippedNoAdapter: 0,
                cached: 0,
              },
              evidence: null,
            },
          }),
        ),
        "utf8",
      ),
    )

    // This is the whole point of the nullable section. `TRUST_INGEST_ARTIFACTS=0` (stage off) and
    // a stage that ran over an empty cohort are different facts, and a gate that cannot tell them
    // apart would report a rate over zero observations as a clean result.
    expect(notRun.attempts.artifacts).toBeNull()
    expect(ranEmpty.attempts.artifacts.considered).toBe(0)
    expect(ranEmpty.attempts.artifacts).not.toBeNull()
  })
})

describe("a malformed run id is refused, not written (control #R4)", () => {
  for (const bad of [
    "../escape",
    `a${sep}b`,
    "a/b",
    "",
    ".hidden",
    "x".repeat(129),
  ]) {
    it(`refuses ${JSON.stringify(bad)}`, () => {
      const root = tempRoot()
      expect(() => writeRunReport(root, report({ runId: bad }))).toThrow(/run id/i)
      // The refusal must leave the directory untouched: a rejected id that still created a file
      // would be the INV-R7 violation the validation exists to prevent.
      expect(readdirSync(reportsRoot(root))).toEqual([])
    })
  }

  it("accepts the shapes `beginCompilerRun` actually mints", () => {
    const root = tempRoot()
    for (const ok of ["r-0001", "abc123", "run_2026-08-31T00.00.00.000Z", "A1"]) {
      expect(() => writeRunReport(root, report({ runId: ok }))).not.toThrow()
      expect(existsSync(runReportPath(root, ok))).toBe(true)
    }
  })
})

describe("the writer is required, not decorative (control #R5)", () => {
  it("is a real export, so deleting it breaks the build rather than silently emptying `reports/`", () => {
    expect(typeof writeRunReport).toBe("function")
    expect(typeof reportsRoot).toBe("function")
    expect(typeof runReportPath).toBe("function")
  })

  it("`reports` is still a declared subdir, so the layout owner and the writer agree", () => {
    const root = tempRoot()
    // If someone removes "reports" from INDEX_SUBDIRS, `mkdirSync` in the writer still saves the
    // write — but the store would stop creating the directory eagerly, and the gate's census would
    // read a missing path. Assert the two definitions still point at the same place.
    expect(existsSync(reportsRoot(root))).toBe(true)
    expect(resolveIndexPaths(join(root, "..", "..")).dirs.map((d) => resolve(d))).toContain(
      resolve(reportsRoot(root)),
    )
  })
})
