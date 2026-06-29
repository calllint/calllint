import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findSurfaces, decideRepoSurfaces } from "../src/surface/walk.js"

const CFG = JSON.stringify({
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem@1.0.0", "/tmp"] },
  },
})

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "calllint-walk-"))
  mkdirSync(join(dir, ".cursor"), { recursive: true })
  mkdirSync(join(dir, "node_modules", "evil", ".cursor"), { recursive: true })
  writeFileSync(join(dir, ".cursor", "mcp.json"), CFG)
  writeFileSync(join(dir, ".mcp.json"), CFG)
  writeFileSync(join(dir, "node_modules", "evil", ".cursor", "mcp.json"), CFG)
  writeFileSync(join(dir, "src.ts"), "export const x = 1")
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const OPTS = { now: Date.parse("2026-06-01T00:00:00Z"), generatedAt: "2026-06-01T00:00:00.000Z" }

describe("findSurfaces (shared walker)", () => {
  it("finds repo MCP configs and never descends into node_modules", () => {
    const found = findSurfaces(dir).map((f) => f.replace(/\\/g, "/"))
    expect(found.some((f) => f.endsWith(".cursor/mcp.json"))).toBe(true)
    expect(found.some((f) => f.endsWith("/.mcp.json"))).toBe(true)
    expect(found.some((f) => f.includes("node_modules"))).toBe(false)
  })
})

describe("decideRepoSurfaces", () => {
  it("returns a compact decision per server with a fingerprint hash", () => {
    const decisions = decideRepoSurfaces(dir, OPTS)
    expect(decisions.length).toBeGreaterThanOrEqual(2)
    for (const d of decisions) {
      expect(d.schemaVersion).toBe("calllint.decision.v0")
      expect(d.fingerprintHash.length).toBeGreaterThan(0)
    }
  })
})
