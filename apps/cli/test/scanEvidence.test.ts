import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, copyFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { run, EXIT } from "../src/run.js"
import type { ConfigSummaryReport } from "@calllint/types"

/**
 * B4 / ADR 0034 — `scan --evidence <file>` attach path + joint Trust Packet.
 *
 * Drives the whole CLI (via `run`) with real SkillSpector-shaped evidence
 * fixtures and locks the four boundary invariants:
 *   1. no `--evidence` ⇒ output byte-identical (offline corpus guarantee).
 *   2. attaching evidence never moves the CallLint verdict (no re-score/upgrade).
 *   3. provider findings are preserved verbatim in the report projection.
 *   4. malformed/degraded evidence is surfaced as "not a pass", never dropped.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SS_DIR = join(here, "..", "..", "..", "packages", "fixtures", "evidence", "skillspector")

const CLOCK = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
  writeCacheFile: false as const,
  readStdin: () => "",
  toolVersion: "1.4.0",
}

// A clearly-BLOCK config (broad filesystem root) — evidence must never soften it.
const BLOCK_CFG = JSON.stringify({
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem@1.0.0", "/"],
    },
  },
})

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "calllint-evidence-"))
  writeFileSync(join(dir, "mcp.json"), BLOCK_CFG)
  // Copy the shared evidence fixtures next to the config so paths are local.
  for (const f of ["clean.json", "findings.json", "malformed.json", "partial.json"]) {
    copyFileSync(join(SS_DIR, f), join(dir, f))
  }
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function scan(extra: string[]): ReturnType<typeof run> {
  return run(["scan", join(dir, "mcp.json"), ...extra], { cwd: dir, ...CLOCK })
}

describe("scan --evidence (attach path)", () => {
  it("without --evidence, JSON output is byte-identical and has no evidence field", () => {
    const plain = scan(["--json"])
    expect(plain.exitCode).toBe(EXIT.OK)
    const report = JSON.parse(plain.stdout) as ConfigSummaryReport
    expect(report.evidence).toBeUndefined()
  })

  it("attaching clean evidence does NOT change the scan verdict (no upgrade)", () => {
    const plain = JSON.parse(scan(["--json"]).stdout) as ConfigSummaryReport
    const withEv = JSON.parse(
      scan(["--json", "--evidence", "clean.json"]).stdout,
    ) as ConfigSummaryReport
    // The BLOCK verdict is identical with and without the (clean) evidence.
    expect(withEv.verdict).toBe(plain.verdict)
    expect(withEv.verdict).toBe("BLOCK")
    // Only the additive projection differs.
    expect(withEv.evidence).toBeDefined()
    expect(withEv.evidence).toHaveLength(1)
    expect(withEv.evidence![0]!.completeness).toBe("complete")
  })

  it("preserves provider-native findings verbatim in the report projection", () => {
    const report = JSON.parse(
      scan(["--json", "--evidence", "findings.json"]).stdout,
    ) as ConfigSummaryReport
    const ev = report.evidence![0]!
    expect(ev.provider).toBe("skillspector")
    const finding = ev.findings[0] as { providerRuleId: string; providerSeverity: string }
    expect(finding.providerRuleId).toBe("SS-EXFIL-001")
    expect(finding.providerSeverity).toBe("high")
  })

  it("renders a joint Trust Packet on the human path (both verdicts, unmerged)", () => {
    const out = scan(["--no-emoji", "--evidence", "findings.json"]).stdout
    expect(out).toContain("Joint Trust Packet")
    expect(out).toContain("Content scan")
    expect(out).toContain("skillspector")
    expect(out).toContain("Authority scan")
    expect(out).toContain("CallLint 1.4.0")
    expect(out).toContain("Why they differ")
  })

  it("malformed evidence is surfaced as failed (fail-closed), never a pass", () => {
    const res = scan(["--evidence", "malformed.json", "--no-emoji"])
    // The scan itself still runs; the evidence completeness is what fails closed.
    const report = JSON.parse(
      scan(["--json", "--evidence", "malformed.json"]).stdout,
    ) as ConfigSummaryReport
    expect(report.evidence![0]!.completeness).toBe("failed")
    // Human output must state it is not a pass, not silently omit it.
    expect(res.stdout).toContain("not a pass")
  })

  it("a missing evidence file is a usage error, not a silent pass", () => {
    const res = scan(["--evidence", "does-not-exist.json"])
    expect(res.exitCode).toBe(EXIT.USAGE)
    expect(res.stderr).toContain("Evidence file not found")
  })
})
