#!/usr/bin/env node
/**
 * agent-trust-bench — CallLint × SkillSpector complementarity gate (B4 / ADR 0034).
 *
 * For each case, drives the BUILT CLI exactly as a user would:
 *   calllint scan <input> --evidence <skillspector-report> --json
 * then asserts the case's expected.json contract:
 *   - CallLint's own authority verdict (unchanged by the evidence),
 *   - required authority finding ids,
 *   - the attached evidence provider + completeness + findings-count bounds,
 *   - the never-SAFE floor (an incomplete/clean content scan is never a pass).
 *
 * The value proven: SkillSpector (content) and CallLint (authority) answer
 * different questions, so they can disagree — and a degraded/partial content
 * scan never upgrades a CallLint verdict (the no-upgrade invariant).
 *
 * Hard guarantees (auditable), same posture as scripts/run-corpus.mjs:
 *   - Never executes the scanned MCP server (CallLint only reads config statically).
 *   - Never touches the network (no --online).
 *   - Never runs SkillSpector — its reports are committed fixtures.
 *   - Never mutates bench files (unless --write-artifacts is passed).
 *   - Deterministic: --generated-at is pinned.
 *
 * Exit codes:
 *   0  all bench contracts hold
 *   1  one or more contract failures
 *   2  malformed bench dir, missing CLI build, or invalid CLI output
 *
 * Usage:
 *   node scripts/run-bench.mjs [--verbose] [--case <caseId>] [--write-artifacts]
 */
import fs from "node:fs"
import path from "node:path"
import process from "node:process"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const benchRoot = path.join(repoRoot, "packages", "fixtures", "bench")
const indexPath = path.join(benchRoot, "index.json")

/** Pinned instant → deterministic generatedAt (matches the corpus runner). */
const FIXED_NOW = "2026-06-16T00:00:00.000Z"

class BenchError extends Error {}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (err) {
    throw new BenchError(`Cannot read JSON at ${filePath}: ${err.message}`)
  }
}

function parseCliArgs(argv) {
  const args = { verbose: false, caseId: null, writeArtifacts: false }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--verbose") args.verbose = true
    else if (arg === "--write-artifacts") args.writeArtifacts = true
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
  throw new BenchError(
    ["Cannot find the built CallLint CLI.", "Run `pnpm build` before `pnpm bench:test`.", `Expected: ${candidate}`].join(
      "\n",
    ),
  )
}

/** All finding ids across every server report. */
function allFindingIds(report) {
  if (!report || !Array.isArray(report.reports)) return []
  return report.reports.flatMap((r) => (Array.isArray(r.findings) ? r.findings.map((f) => f.id) : []))
}

/** Spawn the built CLI, returning parsed JSON stdout (throws on non-JSON). */
function runCliJson(cliEntrypoint, cliArgs) {
  const result = spawnSync(process.execPath, [cliEntrypoint, ...cliArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    // No --online, so the run is fully offline; the server binary is never spawned.
    env: { ...process.env, NO_COLOR: "1" },
  })
  if (result.error) throw new BenchError(`Failed to spawn CLI: ${result.error.message}`)
  if (!result.stdout || !result.stdout.trim()) {
    throw new BenchError(
      [`CallLint produced no stdout.`, `args: ${cliArgs.join(" ")}`, `exit=${result.status}`, `stderr: ${result.stderr}`].join(
        "\n",
      ),
    )
  }
  try {
    return JSON.parse(result.stdout)
  } catch (err) {
    throw new BenchError(
      [
        "CallLint stdout was not valid JSON.",
        `args: ${cliArgs.join(" ")}`,
        `exit=${result.status}`,
        `stdout: ${result.stdout.slice(0, 400)}`,
        `parse: ${err.message}`,
      ].join("\n"),
    )
  }
}

/** Run `scan <input> --evidence <report> --json` and parse the joint report. */
function runScan(cliEntrypoint, inputPath, evidencePath) {
  return runCliJson(cliEntrypoint, [
    "scan",
    inputPath,
    "--evidence",
    evidencePath,
    "--json",
    "--no-emoji",
    "--generated-at",
    FIXED_NOW,
  ])
}

/**
 * Run `trust prepare <input> --json` and parse the read-only preparation
 * (artifact + authority + decision). Used only to persist the authority-manifest
 * artifact when `--write-artifacts` is set — it is not asserted here (the joint
 * scan above is the gate). G3 shipped in v1.3.0, so this is a real manifest.
 */
function runTrustPrepare(cliEntrypoint, inputPath) {
  return runCliJson(cliEntrypoint, ["trust", "prepare", inputPath, "--json", "--generated-at", FIXED_NOW])
}

/** Compare one bench case's joint scan output against its expected.json. */
function compareCase(caseId, expected, report) {
  const failures = []
  const verdict = report.verdict
  const ids = allFindingIds(report)
  const evidence = Array.isArray(report.evidence) ? report.evidence[0] : undefined

  // --- Authority side (CallLint's own verdict; evidence must not have moved it) ---
  if (verdict !== expected.authority.verdict) {
    failures.push(`authority verdict: expected ${expected.authority.verdict}, got ${verdict ?? "<missing>"}`)
  }
  for (const id of expected.authority.requiredFindingIds ?? []) {
    if (!ids.includes(id)) failures.push(`required authority finding missing: ${id}`)
  }

  // --- Content side (the attached evidence envelope, provenance-preserved) ---
  if (!evidence) {
    failures.push("evidence envelope missing from the report (scan --evidence did not attach)")
  } else {
    if (evidence.provider !== expected.content.provider) {
      failures.push(`evidence provider: expected ${expected.content.provider}, got ${evidence.provider}`)
    }
    if (evidence.completeness !== expected.content.completeness) {
      failures.push(
        `evidence completeness: expected ${expected.content.completeness}, got ${evidence.completeness}`,
      )
    }
    const n = Array.isArray(evidence.findings) ? evidence.findings.length : -1
    if (typeof expected.content.findingsAtLeast === "number" && n < expected.content.findingsAtLeast) {
      failures.push(`evidence findings ${n} < expected minimum ${expected.content.findingsAtLeast}`)
    }
    if (typeof expected.content.findingsAtMost === "number" && n > expected.content.findingsAtMost) {
      failures.push(`evidence findings ${n} > expected maximum ${expected.content.findingsAtMost}`)
    }
  }

  // --- The never-SAFE floor: neither a clean nor a partial content scan is a pass ---
  if (expected.mustNeverBeSafe && verdict === "SAFE") {
    failures.push("DANGEROUS FALSE SAFE: bench case must never be SAFE")
  }

  return { caseId, verdict, ids, evidence, failures }
}

function main() {
  const cli = parseCliArgs(process.argv)
  const index = readJson(indexPath)
  if (!Array.isArray(index.cases)) throw new BenchError("index.json has no `cases` array")

  const entrypoint = findCliEntrypoint()
  const selected = cli.caseId ? index.cases.filter((c) => c.caseId === cli.caseId) : index.cases
  if (selected.length === 0) throw new BenchError(`No bench case matched: ${cli.caseId}`)

  const results = []
  for (const entry of selected) {
    const caseDir = path.join(benchRoot, entry.path)
    const expected = readJson(path.join(caseDir, "expected.json"))
    if (expected.caseId !== entry.caseId) {
      throw new BenchError(`${entry.caseId}: expected.json caseId (${expected.caseId}) != index (${entry.caseId})`)
    }

    const inputPath = path.join(caseDir, "input", "mcp.json")
    const evidencePath = path.join(caseDir, "skillspector-report.json")
    const report = runScan(entrypoint, inputPath, evidencePath)

    // Reproducibility artifacts: persist the exact CallLint report the case
    // asserts, plus the read-only trust-preparation (artifact + authority +
    // decision) via `trust prepare`. Off by default (read-only gate);
    // `--write-artifacts` regenerates them after a config or engine change.
    if (cli.writeArtifacts) {
      fs.writeFileSync(path.join(caseDir, "calllint-report.json"), `${JSON.stringify(report, null, 2)}\n`)
      const prep = runTrustPrepare(entrypoint, inputPath)
      fs.writeFileSync(path.join(caseDir, "authority-manifest.json"), `${JSON.stringify(prep, null, 2)}\n`)
    }

    const cmp = compareCase(entry.caseId, expected, report)
    results.push(cmp)

    if (cli.verbose || cmp.failures.length > 0) {
      console.log(`\n${entry.caseId}`)
      console.log(`  authority verdict: ${cmp.verdict}   content: ${cmp.evidence?.completeness ?? "<none>"}`)
      console.log(`  authority findings: ${cmp.ids.join(", ") || "(none)"}`)
      for (const f of cmp.failures) console.log(`  FAIL: ${f}`)
    }
  }

  const failures = results.flatMap((r) => r.failures.map((f) => ({ caseId: r.caseId, failure: f })))
  const dangerousFalseSafe = failures.filter((f) => f.failure.startsWith("DANGEROUS FALSE SAFE")).length

  console.log("\nAgent-Trust-Bench — Complementarity Summary")
  console.log("-------------------------------------------")
  console.log(`Total cases:          ${results.length}`)
  console.log(`Contract failures:    ${failures.length}`)
  console.log(`Dangerous false SAFE: ${dangerousFalseSafe}`)
  for (const r of results) {
    console.log(`  ${r.caseId}: content=${r.evidence?.completeness ?? "<none>"} · authority=${r.verdict}`)
  }

  if (failures.length > 0) {
    console.log("\nFAILURES:")
    for (const f of failures) console.log(`  ${f.caseId}: ${f.failure}`)
    process.exitCode = 1
    return
  }

  console.log("\nAll agent-trust-bench contracts hold.")
}

try {
  main()
} catch (err) {
  if (err instanceof BenchError) {
    console.error(`bench error: ${err.message}`)
    process.exitCode = 2
  } else {
    console.error(err.stack || String(err))
    process.exitCode = 2
  }
}
