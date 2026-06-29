import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run, EXIT } from "../src/run.js"

const CLOCK = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
}

const CFG_A = JSON.stringify({
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@1.0.0", "/tmp"] },
  },
})
const CFG_B = JSON.stringify({
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@2.0.0", "/tmp"] },
  },
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "calllint-approve-"))
  mkdirSync(join(dir, ".cursor"), { recursive: true })
  writeFileSync(join(dir, ".cursor", "mcp.json"), CFG_A)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const deps = (over: Record<string, unknown> = {}) => ({
  cwd: dir,
  readStdin: () => "",
  ...CLOCK,
  ...over,
})

describe("approve command (P4.3)", () => {
  it("writes .calllint/approved.json seeded from the repo surface", () => {
    const res = run(["approve"], deps())
    expect(res.exitCode).toBe(EXIT.OK)
    expect(res.stdout).toContain("Approved")
    expect(existsSync(join(dir, ".calllint", "approved.json"))).toBe(true)
  })

  it("--json emits a calllint.approved.v0 state without writing when writeFile=false", () => {
    const res = run(["approve", "--json"], deps({ writeCacheFile: false }))
    const parsed = JSON.parse(res.stdout)
    expect(parsed.schemaVersion).toBe("calllint.approved.v0")
    expect(Array.isArray(parsed.approved)).toBe(true)
    expect(existsSync(join(dir, ".calllint", "approved.json"))).toBe(false)
  })
})

describe("verify --approved (P4.3)", () => {
  it("errors when no approved state exists", () => {
    const res = run(["verify", "--approved"], deps())
    expect(res.exitCode).toBe(EXIT.ERROR)
    expect(res.stderr).toContain("No approved state")
  })

  it("clean repo (unchanged surface) reports no drift, exit 0 under --ci", () => {
    run(["approve"], deps())
    const res = run(["verify", "--approved", "--ci"], deps())
    expect(res.stdout).toContain("no drift")
    expect(res.exitCode).toBe(EXIT.OK)
  })

  it("a mutated surface drifts and fails --ci with exit 40", () => {
    run(["approve"], deps())
    // Rug-pull: bump the package version after approval.
    writeFileSync(join(dir, ".cursor", "mcp.json"), CFG_B)
    const res = run(["verify", "--approved", "--ci"], deps())
    expect(res.stdout).toContain("DRIFT")
    expect(res.exitCode).toBe(EXIT.DRIFT)
  })

  it("--approved --json emits the approved-drift report", () => {
    run(["approve"], deps())
    const res = run(["verify", "--approved", "--json"], deps())
    const parsed = JSON.parse(res.stdout)
    expect(parsed.schemaVersion).toBe("calllint.approveddrift.v0")
    expect(parsed.drifted).toBe(false)
  })

  it("the plain verify (baseline mode) is unchanged when --approved is absent", () => {
    // No baseline written → the existing baseline-mode error path still fires.
    const res = run(["verify"], deps())
    expect(res.stderr).toContain("No baseline found")
  })
})
