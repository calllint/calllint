import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { goldenPath, GOLDEN_CASES } from "@calllint/fixtures"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const cliDir = join(repoRoot, "apps", "cli")
const binary = join(cliDir, "dist", "index.js")

/** Run the built binary, capturing stdout + exit code. */
function runBin(args: string[], input?: string): { stdout: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, [binary, ...args], {
      input: input ?? "",
      encoding: "utf8",
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer (prevent truncation)
    })
    return { stdout, code: 0 }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { stdout: e.stdout ?? "", code: e.status ?? 1 }
  }
}

describe("built binary E2E", () => {
  beforeAll(() => {
    // The shipped artifact is built once by the vitest globalSetup
    // (tests/e2e/globalSetup.ts); this guards that it is present.
    expect(existsSync(binary)).toBe(true)
  })

  it("scans a SAFE config and exits 0", () => {
    const { stdout, code } = runBin([
      "scan",
      goldenPath("safe-time.json"),
      "--no-emoji",
    ])
    expect(code).toBe(0)
    expect(stdout).toContain("SAFE")
  })

  it("BLOCK config with --ci exits 30", () => {
    const { code } = runBin([
      "scan",
      goldenPath("block-filesystem.json"),
      "--ci",
      "--no-emoji",
    ])
    expect(code).toBe(30)
  })

  it("UNKNOWN config with --ci exits 20", () => {
    const { code } = runBin([
      "scan",
      goldenPath("unknown-remote.json"),
      "--ci",
      "--no-emoji",
    ])
    expect(code).toBe(20)
  })

  it("reads from stdin and emits valid JSON", () => {
    const input = readFileSync(goldenPath("block-prompt-poison.json"), "utf8")
    const { stdout } = runBin(["scan", "--stdin", "--json"], input)
    const parsed = JSON.parse(stdout)
    expect(parsed.verdict).toBe("BLOCK")
    expect(parsed.reports[0].findings.some((f: { id: string }) => f.id === "prompt.poisoning")).toBe(true)
  })

  it("the full golden verdict contract holds through the binary", () => {
    // Drive the contract from the single source of truth (GOLDEN_CASES) so the
    // E2E set can never silently drift out of sync with the fixture registry.
    // review-financial (MONEY/S5) is included here by construction — adding any
    // golden case automatically extends this binary-level contract.
    for (const c of GOLDEN_CASES) {
      if (c.expect === "parse-error") continue
      const input = readFileSync(goldenPath(c.file), "utf8")
      const { stdout } = runBin(["scan", "--stdin", "--json"], input)

      // Guard against truncated/empty output
      if (!stdout || stdout.trim().length === 0) {
        throw new Error(`Empty stdout for ${c.file}`)
      }

      let parsed: any
      try {
        parsed = JSON.parse(stdout)
      } catch (parseErr) {
        throw new Error(`JSON parse failed for ${c.file}: ${parseErr}\nStdout: ${stdout.slice(0, 500)}`)
      }

      expect(parsed.verdict, c.file).toBe(c.expect)

      const report = parsed.reports[0]
      if (c.expectRiskClass) {
        expect(report.riskClass, `${c.file} riskClass`).toBe(c.expectRiskClass)
      }
      for (const sym of c.expectSymbols ?? []) {
        expect(report.symbols, `${c.file} symbols`).toContain(sym)
      }
    }
  })

  it("malformed config exits 3 with a parse error", () => {
    const input = readFileSync(goldenPath("malformed.json"), "utf8")
    const { code } = runBin(["scan", "--stdin"], input)
    expect(code).toBe(3)
  })

  it("prints help and exits 0", () => {
    const { stdout, code } = runBin(["help"])
    expect(code).toBe(0)
    expect(stdout).toContain("USAGE")
  })
})
