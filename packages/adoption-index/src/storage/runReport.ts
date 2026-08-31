/**
 * runReport — the compile run's own record of what it did, written where a gate can read it.
 *
 * ## Why this file exists
 *
 * `reports` has been declared in `INDEX_SUBDIRS` since the first commit, and
 * `scripts/gate-s1.ts:438` has been counting the files in it for just as long. Nothing ever wrote
 * one. So the gate's census printed `reports=0` on every run, and that 0 was indistinguishable
 * from a run that had simply never happened — the repo's dominant fault class
 * (`maps/guards.md`): a reader whose subject does not exist reads a benign value forever and never
 * says so.
 *
 * (The wording above avoids putting a quoted phrase after the word `from`: the INV-04 specifier
 * extractor in `tests/invariants/adoption-index-no-execution.invariants.test.ts` scans for an
 * import-or-export followed by `from` and a quoted string, and it does not stop at a comment
 * boundary, so quoted prose in a docblock is counted as an import. Two comments in `tarInspect.ts`
 * are grandfathered into its vouched-for set for exactly this reason; adding a third would widen a
 * security assertion to accommodate a comment.)
 *
 * The gate cannot instead read `compiler_runs` out of SQLite: `gate-s1.ts` deliberately declines to
 * open the database, because `better-sqlite3` is pinned to 12.9.0 against an ABI cliff and a gate
 * that fails to load a native module is a gate that reports nothing. A JSON file on disk has no
 * ABI. That asymmetry is the whole reason this projection exists alongside the `compiler_runs` row:
 * the row is the record of truth, this is the readable copy.
 *
 * ## What it is NOT
 *
 * It is not a second source of truth. `concludeCompilerRun` writes the row; this writes a
 * projection of the same numbers, in the same call, from the same in-memory metrics. If they ever
 * disagree, the row wins and this file is the bug. ADR 0061 §5 ("nothing served ever queries the
 * compiler") is unaffected — nothing *served* reads this either; only a gate does.
 *
 * It is also not a rate. Every field is a raw count, and the denominators are written out
 * alongside the numerators, so a reader can see a zero denominator instead of receiving a
 * percentage computed over one. That is deliberate: the empty-denominator defect this repo keeps
 * finding (`gate-s0.ts`'s first INV-R4 printed "0 dangerous false-SAFE" as a PASS from 39 reads of
 * a nonexistent path) can only be caught downstream if the counts arrive unaggregated.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { isInsideRoot, runReportPath } from "./paths.js"
import type { CompilerRunMetrics } from "../domain/job.js"

/** The schema id, versioned so a reader can refuse a shape it does not know. */
export const RUN_REPORT_SCHEMA = "calllint.compiler-run-report.v1"

export interface RunReportAttempts {
  /**
   * Artifact resolution, as counted by `resolveArtifacts`. `considered` is the denominator a
   * failure rate needs; `skippedNoAdapter` is reported SEPARATELY and is deliberately NOT folded
   * into failures, because not-tried is not tried-and-failed (`resolveArtifacts.ts:33`). A rate
   * that conflated them would blame the resolver for subjects it correctly declined to touch.
   */
  readonly artifacts: {
    readonly considered: number
    readonly fetched: number
    readonly unavailable: number
    readonly rejected: number
    readonly skippedNoAdapter: number
    readonly cached: number
  } | null
  /** Evidence compilation, as counted by `compileEvidence`. Same reasoning as above. */
  readonly evidence: {
    readonly considered: number
    readonly compiled: number
    readonly unchanged: number
    readonly noDigest: number
    readonly blobUnreadable: number
    readonly archiveRefused: number
  } | null
}

export interface RunReport {
  readonly schema: typeof RUN_REPORT_SCHEMA
  /** The `compiler_runs.run_id` this projects. The join key back to the record of truth. */
  readonly runId: string
  readonly runType: string
  /** `SUCCEEDED` | `PARTIAL` | `FAILED`, exactly as `gradeRun` derived it — never a caller's opinion. */
  readonly outcome: string
  readonly startedAt: string
  readonly completedAt: string
  /** Null when the run threw: there is no output manifest for a run that did not finish. */
  readonly outputManifestDigest: string | null
  readonly inputManifestDigest: string
  readonly metrics: CompilerRunMetrics
  readonly attempts: RunReportAttempts
}

/**
 * Write one run's report under `<root>/reports/run-<runId>.json`.
 *
 * Staging + rename, for the same reason `cas.ts` does it: a gate that reads the directory mid-write
 * must never see a half-written JSON file and must never have to distinguish a truncated report
 * from a real one. `rename` within one filesystem is atomic.
 *
 * Returns the path written, so a caller can log it and a test can assert on it without
 * re-deriving the layout.
 */
export function writeRunReport(root: string, report: RunReport): string {
  const target = runReportPath(root, report.runId)
  const staging = `${target}.part`

  // Belt-and-braces on INV-R7, matching `cas.ts`: `runReportPath` already validates the run id
  // into a filename-safe shape so this cannot fire today, but a silent write outside the index
  // root is exactly what the invariant exists to prevent, and one `resolve` costs nothing.
  if (!isInsideRoot(root, target) || !isInsideRoot(root, staging)) {
    throw new Error(`writeRunReport: refusing to write outside the index root: ${target}`)
  }

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(staging, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  try {
    renameSync(staging, target)
  } catch (err) {
    rmSync(staging, { force: true })
    throw err
  }
  return target
}
