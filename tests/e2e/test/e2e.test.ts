import { describe, it, expect, beforeAll } from "vitest"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { goldenPath } from "@mcpguard/fixtures"

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
    })
    return { stdout, code: 0 }
  } catch (err) {
    const e = err as { status?: number; stdout?: string }
    return { stdout: e.stdout ?? "", code: e.status ?? 1 }
  }
}

describe("built binary E2E", () => {
  beforeAll(() => {
    // Ensure the shipped artifact exists and is fresh.
    execFileSync(process.execPath, ["./build.mjs"], { cwd: cliDir, stdio: "ignore" })
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
    const cases: Array<[string, string]> = [
      ["safe-time.json", "SAFE"],
      ["review-github.json", "REVIEW"],
      ["block-filesystem.json", "BLOCK"],
      ["unknown-remote.json", "UNKNOWN"],
      ["block-prompt-poison.json", "BLOCK"],
      ["review-unpinned-package.json", "REVIEW"],
      ["block-dangerous-command.json", "BLOCK"],
      ["safe-filesystem-workspace.json", "SAFE"],
    ]
    for (const [file, expected] of cases) {
      const input = readFileSync(goldenPath(file), "utf8")
      const { stdout } = runBin(["scan", "--stdin", "--json"], input)
      expect(JSON.parse(stdout).verdict, file).toBe(expected)
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
