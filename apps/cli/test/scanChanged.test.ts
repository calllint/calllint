import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run, EXIT } from "../src/run.js"
import { changedConfigPaths } from "../src/commands/changedConfigs.js"

const CLOCK = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
  writeCacheFile: false as const,
  readStdin: () => "",
}

// A clearly-BLOCK config (broad filesystem root) and a clearly-SAFE one.
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
  dir = mkdtempSync(join(tmpdir(), "calllint-changed-"))
  mkdirSync(join(dir, ".cursor"), { recursive: true })
  mkdirSync(join(dir, ".claude"), { recursive: true })
  writeFileSync(join(dir, ".cursor", "mcp.json"), BLOCK_CFG)
  writeFileSync(join(dir, ".claude", "settings.json"), SAFE_CFG)
  writeFileSync(join(dir, "README.md"), "# not a config")
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe("changedConfigPaths (path filter)", () => {
  it("keeps only known agent-tool config paths that exist", () => {
    const diff = () =>
      [".cursor/mcp.json", "README.md", "src/index.ts", ".claude/settings.json"].join("\n")
    const got = changedConfigPaths(dir, diff)
    expect(got).toHaveLength(2)
    expect(got.some((p) => p.endsWith("mcp.json"))).toBe(true)
    expect(got.some((p) => p.endsWith("settings.json"))).toBe(true)
    expect(got.some((p) => p.endsWith("README.md"))).toBe(false)
  })

  it("skips changed config paths that no longer exist on disk", () => {
    const diff = () => ["deleted/.cursor/mcp.json", ".mcp.json"].join("\n")
    expect(changedConfigPaths(dir, diff)).toHaveLength(0)
  })

  it("returns [] for an empty diff or a thrown diff source", () => {
    expect(changedConfigPaths(dir, () => "")).toHaveLength(0)
    expect(
      changedConfigPaths(dir, () => {
        throw new Error("not a git repo")
      }),
    ).toHaveLength(0)
  })
})

describe("scan --changed", () => {
  const base = (diff: () => string) => ({ ...CLOCK, cwd: dir, getChangedFilesDiff: diff })

  it("is a no-op (exit 0) when no agent-tool configs changed", () => {
    const r = run(["scan", "--changed"], base(() => "src/index.ts\nREADME.md"))
    expect(r.exitCode).toBe(EXIT.OK)
    expect(r.stdout).toContain("Nothing to scan")
  })

  it("usage error when no git diff source is available", () => {
    const r = run(["scan", "--changed"], { ...CLOCK, cwd: dir })
    expect(r.exitCode).toBe(EXIT.USAGE)
    expect(r.stderr).toContain("git diff source")
  })

  it("one changed config behaves like a single scan (BLOCK exits 30 under --ci)", () => {
    const r = run(["scan", "--changed", "--ci"], base(() => ".cursor/mcp.json"))
    expect(r.exitCode).toBe(EXIT.BLOCK)
    expect(r.stdout).toContain("BLOCK")
  })

  it("--changed --json always emits an array (length 1 for a single config)", () => {
    const r = run(["scan", "--changed", "--json"], base(() => ".cursor/mcp.json"))
    const arr = JSON.parse(r.stdout)
    expect(Array.isArray(arr)).toBe(true)
    expect(arr).toHaveLength(1)
    expect(arr[0].reportKind).toBe("config-summary")
    expect(arr[0].verdict).toBe("BLOCK")
  })

  it("N>1 changed configs: worst verdict drives the exit code under --ci", () => {
    const diff = () => [".cursor/mcp.json", ".claude/settings.json"].join("\n")
    const r = run(["scan", "--changed", "--ci"], base(diff))
    // BLOCK (filesystem) beats SAFE (time) → exit 30
    expect(r.exitCode).toBe(EXIT.BLOCK)
  })

  it("N>1 changed configs --json emits a valid JSON array of summaries", () => {
    const diff = () => [".cursor/mcp.json", ".claude/settings.json"].join("\n")
    const r = run(["scan", "--changed", "--json"], base(diff))
    const arr = JSON.parse(r.stdout)
    expect(Array.isArray(arr)).toBe(true)
    expect(arr).toHaveLength(2)
    const verdicts = arr.map((s: { verdict: string }) => s.verdict).sort()
    expect(verdicts).toEqual(["BLOCK", "SAFE"])
  })

  it("N>1 changed configs --markdown concatenates with a separator", () => {
    const diff = () => [".cursor/mcp.json", ".claude/settings.json"].join("\n")
    const r = run(["scan", "--changed", "--markdown"], base(diff))
    expect(r.stdout).toContain("## CallLint: BLOCK")
    expect(r.stdout).toContain("## CallLint: SAFE")
    expect(r.stdout).toContain("\n---\n")
  })
})
