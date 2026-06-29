import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run, EXIT } from "../src/run.js"

const CLOCK = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
  writeCacheFile: false as const,
}

const BLOCK_CFG = JSON.stringify({
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem@1.0.0", "/"],
    },
  },
})
const SAFE_CFG = JSON.stringify({
  mcpServers: {
    time: { command: "npx", args: ["-y", "@modelcontextprotocol/server-time@1.0.0"] },
  },
})

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "calllint-check-"))
  mkdirSync(join(dir, ".cursor"), { recursive: true })
  mkdirSync(join(dir, "node_modules", "evil", ".cursor"), { recursive: true })
  writeFileSync(join(dir, ".cursor", "mcp.json"), BLOCK_CFG)
  writeFileSync(join(dir, ".mcp.json"), SAFE_CFG)
  // A config buried in node_modules must be ignored by scan-all.
  writeFileSync(join(dir, "node_modules", "evil", ".cursor", "mcp.json"), BLOCK_CFG)
  writeFileSync(join(dir, "src.ts"), "export const x = 1")
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const deps = (over: Record<string, unknown> = {}) => ({
  cwd: dir,
  readStdin: () => "",
  ...CLOCK,
  ...over,
})

describe("check command (P1.8)", () => {
  it("prints a compact decision block for a config path", () => {
    const res = run(["check", join(dir, ".cursor", "mcp.json")], deps())
    expect(res.stdout).toMatch(/BLOCK/)
    expect(res.stdout).toContain("Reasons:")
    expect(res.stdout).toContain("Next:")
    expect(res.exitCode).toBe(EXIT.BLOCK)
  })

  it("--json emits a compact decision under 1 KB", () => {
    const res = run(["check", join(dir, ".cursor", "mcp.json"), "--json"], deps())
    const parsed = JSON.parse(res.stdout)
    expect(parsed.schemaVersion).toBe("calllint.decision.v0")
    expect(parsed.verdict).toBe("BLOCK")
    expect(Buffer.byteLength(res.stdout, "utf8")).toBeLessThan(1024)
  })

  it("accepts an install snippet via stdin", () => {
    const res = run(["check", "--stdin"], deps({ readStdin: () => "npx -y demo-mcp@1.2.3" }))
    expect(res.stdout).toMatch(/REVIEW|SAFE|UNKNOWN|BLOCK/)
    expect(res.stdout).toContain("stdin:snippet")
  })

  it("reports UNKNOWN (not SAFE) for an unrecognized snippet", () => {
    const res = run(["check", "--stdin"], deps({ readStdin: () => "please install my tool" }))
    expect(res.exitCode).toBe(EXIT.UNKNOWN)
  })

  it("--explain falls back to the rich evidence report", () => {
    const res = run(["check", join(dir, ".cursor", "mcp.json"), "--explain"], deps())
    expect(res.stdout).toContain("label:")
    expect(res.stdout).toContain("class:")
  })
})

describe("scan-all command (P1.9)", () => {
  it("finds repo surfaces, ignores node_modules, prints a table", () => {
    const res = run(["scan-all"], deps())
    expect(res.stdout).toMatch(/agent-tool surface/)
    expect(res.stdout).toContain(".cursor")
    expect(res.stdout).toContain(".mcp.json")
    // The node_modules config must NOT appear.
    expect(res.stdout).not.toContain("node_modules")
  })

  it("exits BLOCK because the .cursor config is a blocker", () => {
    const res = run(["scan-all"], deps())
    expect(res.exitCode).toBe(EXIT.BLOCK)
  })

  it("--json emits an array of compact decisions", () => {
    const res = run(["scan-all", "--json"], deps())
    const parsed = JSON.parse(res.stdout)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.every((d: { schemaVersion: string }) => d.schemaVersion === "calllint.decision.v0")).toBe(true)
  })
})
