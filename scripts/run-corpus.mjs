#!/usr/bin/env node
/**
 * CallLint corpus release gate.
 *
 * Scans every case in packages/fixtures/corpus against the BUILT CLI exactly as
 * a CI user would (`calllint scan <file> --json`), then checks only stable
 * SAFETY CONTRACT fields from expected.calllint.json — never the human-readable
 * report text. Prints a calibration summary.
 *
 * Hard guarantees (auditable):
 *   - Never executes the scanned MCP server (CallLint only reads config statically).
 *   - Never touches the network (the CLI is offline unless --online is passed; it isn't).
 *   - Never mutates corpus files.
 *   - Deterministic: --generated-at is pinned, so output is reproducible.
 *
 * Exit codes:
 *   0  all contracts hold
 *   1  one or more contract failures
 *   2  malformed corpus, missing CLI build, or invalid CLI output
 *
 * Usage:
 *   node scripts/run-corpus.mjs [--verbose] [--case <caseId>]
 */
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const corpusRoot = path.join(repoRoot, "packages", "fixtures", "corpus")
const indexPath = path.join(corpusRoot, "index.json")

/** Pinned instant → deterministic generatedAt in every report. */
const FIXED_NOW = "2026-06-16T00:00:00.000Z"

/** S0..S5 ordering for "max risk class" comparison. */
const RISK_RANK = { S0: 0, S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 }

class CorpusError extends Error {}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (err) {
    throw new CorpusError(`Cannot read JSON at ${filePath}: ${err.message}`)
  }
}

function parseCliArgs(argv) {
  const args = { verbose: false, caseId: null }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--verbose") args.verbose = true
    else if (arg === "--case") {
      args.caseId = argv[i + 1]
      i += 1
    } else if (arg.startsWith("--case=")) {
      args.caseId = arg.slice("--case=".length)
    }
  }
  return args
}

function findCliEntrypoint() {
  const candidate = path.join(repoRoot, "apps", "cli", "dist", "index.js")
  if (fs.existsSync(candidate)) return candidate
  throw new CorpusError(
    [
      "Cannot find the built CallLint CLI.",
      "Run `pnpm build` before `pnpm corpus:test`.",
      `Expected: ${candidate}`,
    ].join("\n"),
  )
}

/** Collect all findings across every server report in a config-summary report. */
function allFindings(report) {
  if (!report || !Array.isArray(report.reports)) return []
  return report.reports.flatMap((r) => (Array.isArray(r.findings) ? r.findings : []))
}

/** Highest S-class across all server reports (S0 if none). */
function maxRiskClass(report) {
  let max = "S0"
  for (const r of report.reports ?? []) {
    if ((RISK_RANK[r.riskClass] ?? 0) > (RISK_RANK[max] ?? 0)) max = r.riskClass
  }
  return max
}

function hasEvidence(finding) {
  return Array.isArray(finding.evidence) && finding.evidence.length > 0
}

function runScan(cliEntrypoint, inputPath) {
  const result = spawnSync(
    process.execPath,
    [cliEntrypoint, "scan", inputPath, "--json", "--no-emoji", "--generated-at", FIXED_NOW],
    {
      cwd: repoRoot,
      encoding: "utf8",
      // No --online flag is passed, so the scan is fully offline. We do not
      // inherit a shell; the server binary is never spawned by CallLint.
      env: { ...process.env, NO_COLOR: "1" },
    },
  )

  if (result.error) {
    throw new CorpusError(`Failed to spawn CLI: ${result.error.message}`)
  }
  if (!result.stdout || !result.stdout.trim()) {
    throw new CorpusError(
      [`CallLint produced no stdout.`, `exit=${result.status}`, `stderr: ${result.stderr}`].join(
        "\n",
      ),
    )
  }
  try {
    return JSON.parse(result.stdout)
  } catch (err) {
    throw new CorpusError(
      [
        "CallLint stdout was not valid JSON.",
        `exit=${result.status}`,
        `stdout: ${result.stdout.slice(0, 400)}`,
        `stderr: ${result.stderr}`,
        `parse: ${err.message}`,
      ].join("\n"),
    )
  }
}

/** Compare one case's scan output against its expected.calllint.json contract. */
function compareCase(caseId, expected, report) {
  const failures = []
  const verdict = report.verdict
  const maxClass = maxRiskClass(report)
  const findings = allFindings(report)
  const ids = findings.map((f) => f.id)
  const isReviewOrBlock = expected.expectedVerdict === "REVIEW" || expected.expectedVerdict === "BLOCK"

  if (verdict !== expected.expectedVerdict) {
    failures.push(`verdict: expected ${expected.expectedVerdict}, got ${verdict ?? "<missing>"}`)
  }

  if (expected.expectedMaxRiskClass && maxClass !== expected.expectedMaxRiskClass) {
    failures.push(`maxRiskClass: expected ${expected.expectedMaxRiskClass}, got ${maxClass}`)
  }

  if (expected.allowExtraFindings === false) {
    const required = new Set((expected.requiredFindingIds ?? []).map((r) => (typeof r === "string" ? r : r.id)))
    for (const id of ids) {
      if (!required.has(id)) failures.push(`unexpected extra finding (allowExtraFindings=false): ${id}`)
    }
  }

  for (const req of expected.requiredFindingIds ?? []) {
    const id = typeof req === "string" ? req : req.id
    const min = typeof req === "string" ? 1 : (req.minCount ?? 1)
    const count = ids.filter((x) => x === id).length
    if (count < min) failures.push(`required finding ${id}: count ${count} < ${min}`)
  }

  for (const id of expected.forbiddenFindingIds ?? []) {
    if (ids.includes(id)) failures.push(`forbidden finding present: ${id}`)
  }

  const reqs = expected.requirements ?? {}
  if (reqs.mustHaveEvidenceForEveryFinding) {
    for (const f of findings) {
      if (!hasEvidence(f)) failures.push(`finding ${f.id} has no evidence`)
    }
  }
  if (reqs.mustHaveFalsePositiveNoteForReviewOrBlock && isReviewOrBlock) {
    for (const f of findings) {
      if (!f.falsePositiveNote) failures.push(`finding ${f.id} has no falsePositiveNote`)
    }
  }
  if (reqs.mustHaveRemediationForReviewOrBlock && isReviewOrBlock) {
    for (const f of findings) {
      if (!f.fix) failures.push(`finding ${f.id} has no remediation (fix)`)
    }
  }

  if (expected.dangerousFalseSafePolicy?.thisCaseMustNeverBeSafe && verdict === "SAFE") {
    failures.push(`DANGEROUS FALSE SAFE: case must never be SAFE`)
  }

  return { caseId, verdict, maxClass, ids, failures }
}

function main() {
  const cli = parseCliArgs(process.argv)
  const index = readJson(indexPath)
  if (!Array.isArray(index.cases)) throw new CorpusError("index.json has no `cases` array")

  const entrypoint = findCliEntrypoint()
  const selected = cli.caseId ? index.cases.filter((c) => c.caseId === cli.caseId) : index.cases
  if (selected.length === 0) throw new CorpusError(`No corpus case matched: ${cli.caseId}`)

  const results = []
  for (const entry of selected) {
    const caseDir = path.join(corpusRoot, entry.path)
    const source = readJson(path.join(caseDir, "source.json"))
    const expected = readJson(path.join(caseDir, "expected.calllint.json"))

    // Safety preconditions: the corpus must never request execution / network.
    const ep = source.executionPolicy ?? {}
    if (ep.executeTarget !== false) throw new CorpusError(`${entry.caseId}: executionPolicy.executeTarget must be false`)
    if (ep.allowNetwork !== false) throw new CorpusError(`${entry.caseId}: executionPolicy.allowNetwork must be false`)
    if (ep.allowFilesystemMutation !== false) {
      throw new CorpusError(`${entry.caseId}: executionPolicy.allowFilesystemMutation must be false`)
    }
    if (expected.expectedVerdict !== entry.expectedVerdict) {
      throw new CorpusError(
        `${entry.caseId}: index expectedVerdict (${entry.expectedVerdict}) != expected.calllint.json (${expected.expectedVerdict})`,
      )
    }

    const inputPath = path.join(caseDir, source.input.path)
    const report = runScan(entrypoint, inputPath)
    const cmp = compareCase(entry.caseId, expected, report)
    results.push(cmp)

    if (cli.verbose || cmp.failures.length > 0) {
      console.log(`\n${entry.caseId}`)
      console.log(`  verdict: ${cmp.verdict}   maxRiskClass: ${cmp.maxClass}`)
      console.log(`  findings: ${cmp.ids.join(", ") || "(none)"}`)
      for (const f of cmp.failures) console.log(`  FAIL: ${f}`)
    }
  }

  const distribution = results.reduce((acc, r) => {
    const k = r.verdict ?? "MISSING"
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})
  const failures = results.flatMap((r) => r.failures.map((f) => ({ caseId: r.caseId, failure: f })))
  const dangerousFalseSafe = failures.filter((f) => f.failure.startsWith("DANGEROUS FALSE SAFE")).length
  const unknownRatio = results.length ? (distribution.UNKNOWN ?? 0) / results.length : 0

  console.log("\nCallLint Corpus Calibration Summary")
  console.log("-----------------------------------")
  console.log(`Total cases:          ${results.length}`)
  console.log(`Verdict distribution: ${JSON.stringify(distribution)}`)
  console.log(`Contract failures:    ${failures.length}`)
  console.log(`Dangerous false SAFE: ${dangerousFalseSafe}`)
  console.log(`UNKNOWN ratio:        ${(unknownRatio * 100).toFixed(1)}%`)

  if (failures.length > 0) {
    console.log("\nFAILURES:")
    for (const f of failures) console.log(`  ${f.caseId}: ${f.failure}`)
    process.exitCode = 1
    return
  }
  console.log("\nAll corpus contracts hold.")
}

try {
  main()
} catch (err) {
  if (err instanceof CorpusError) {
    console.error(`corpus error: ${err.message}`)
    process.exitCode = 2
  } else {
    console.error(err.stack || String(err))
    process.exitCode = 2
  }
}
