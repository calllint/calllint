import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { goldenPath } from "@calllint/fixtures"

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

describe("receipt E2E (scan --receipt → receipt verify)", () => {
  let workDir: string

  beforeAll(() => {
    execFileSync(process.execPath, ["./build.mjs"], { cwd: cliDir, stdio: "ignore" })
    expect(existsSync(binary)).toBe(true)
    workDir = mkdtempSync(join(tmpdir(), "calllint-receipt-"))
  })

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  it("writes a receipt with --receipt-out and round-trips through verify", () => {
    const out = join(workDir, "r.json")
    const scan = runBin([
      "scan",
      goldenPath("block-filesystem.json"),
      "--no-emoji",
      "--receipt",
      "--receipt-out",
      out,
    ])
    // Scan exit code is unchanged by --receipt (no --ci ⇒ always 0).
    expect(scan.code).toBe(0)
    expect(scan.stdout).toContain("BLOCK")
    expect(existsSync(out)).toBe(true)

    const receipt = JSON.parse(readFileSync(out, "utf8"))
    expect(receipt.schema_version).toBe("calllint.receipt.v0")
    // Verdict is copied from the scan — the receipt never re-judges.
    expect(receipt.verdict).toBe("BLOCK")
    // tool.version is read at runtime from the CLI package, never hardcoded.
    expect(receipt.tool.name).toBe("calllint")
    expect(receipt.tool.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(receipt.receipt_id).toMatch(/^clrec_/)
    // Trust-boundary invariants are stamped false/false.
    expect(receipt.trust_boundaries.executed_target).toBe(false)
    expect(receipt.trust_boundaries.network_used).toBe(false)
    expect(receipt.trust_boundaries.secret_values_read).toBe(false)

    const verify = runBin(["receipt", "verify", out])
    expect(verify.code).toBe(0)
    expect(verify.stdout).toContain("valid")
    expect(verify.stdout).toContain("unsigned local receipt")
  })

  it("scan without --receipt writes no receipt file and is unchanged", () => {
    const out = join(workDir, "should-not-exist.json")
    const scan = runBin(["scan", goldenPath("safe-time.json"), "--no-emoji"])
    expect(scan.code).toBe(0)
    expect(scan.stdout).toContain("SAFE")
    expect(existsSync(out)).toBe(false)
  })

  it("defaults the receipt filename to calllint-receipt.json in cwd", () => {
    // Run with cwd = workDir so the default lands in the temp dir, not the repo.
    const scan = execFileSync(
      process.execPath,
      [binary, "scan", goldenPath("safe-time.json"), "--no-emoji", "--receipt"],
      { encoding: "utf8", cwd: workDir },
    )
    expect(scan).toContain("SAFE")
    expect(existsSync(join(workDir, "calllint-receipt.json"))).toBe(true)
  })

  it("receipt verify rejects a malformed receipt with exit 1", () => {
    const bad = join(workDir, "bad.json")
    // A structurally invalid receipt: wrong schema_version.
    execFileSync(process.execPath, ["-e", `require("fs").writeFileSync(${JSON.stringify(bad)}, '{"schema_version":"nope"}')`])
    const verify = runBin(["receipt", "verify", bad])
    expect(verify.code).toBe(1)
  })

  it("receipt verify rejects non-JSON with exit 1", () => {
    const bad = join(workDir, "notjson.txt")
    execFileSync(process.execPath, ["-e", `require("fs").writeFileSync(${JSON.stringify(bad)}, 'not json at all')`])
    const verify = runBin(["receipt", "verify", bad])
    expect(verify.code).toBe(1)
  })
})
