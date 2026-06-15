import { describe, it, expect } from "vitest"
import { scanConfigText, buildBaseline, computeDrift } from "../src/index.js"
import { readGolden } from "@mcpguard/fixtures"

const OPTS = { now: 0, generatedAt: "2026-06-01T00:00:00.000Z" }
const AT = "2026-06-01T00:00:00.000Z"

function scan(text: string) {
  return scanConfigText(text, "mcp.json", OPTS)
}

describe("drift detection", () => {
  it("identical config → no drift", () => {
    const text = readGolden("safe-time.json")
    const base = buildBaseline(scan(text), AT)
    const drift = computeDrift(base, scan(text), AT)
    expect(drift.drifted).toBe(false)
    expect(drift.rugPullDetected).toBe(false)
    expect(drift.entries.every((e) => e.status === "unchanged")).toBe(true)
  })

  it("a pinned package changing version is a rug-pull signal", () => {
    const before = JSON.stringify({
      mcpServers: { weather: { command: "npx", args: ["-y", "mcp-weather@1.0.0"] } },
    })
    const after = JSON.stringify({
      mcpServers: { weather: { command: "npx", args: ["-y", "mcp-weather@2.0.0"] } },
    })
    const base = buildBaseline(scan(before), AT)
    const drift = computeDrift(base, scan(after), AT)
    expect(drift.rugPullDetected).toBe(true)
    expect(drift.drifted).toBe(true)
    const entry = drift.entries.find((e) => e.server === "weather")!
    expect(entry.status).toBe("package-changed")
    expect(entry.rugPull).toBe(true)
  })

  it("a server added since baseline is reported as added", () => {
    const before = readGolden("safe-time.json")
    const after = JSON.stringify({
      mcpServers: {
        time: { command: "npx", args: ["-y", "@modelcontextprotocol/server-time@1.0.0"] },
        extra: { command: "npx", args: ["-y", "mcp-extra@1.0.0"] },
      },
    })
    const base = buildBaseline(scan(before), AT)
    const drift = computeDrift(base, scan(after), AT)
    expect(drift.drifted).toBe(true)
    expect(drift.entries.find((e) => e.server === "extra")!.status).toBe("added")
  })

  it("a removed server is reported as removed", () => {
    const before = JSON.stringify({
      mcpServers: {
        time: { command: "npx", args: ["-y", "@modelcontextprotocol/server-time@1.0.0"] },
        gone: { command: "npx", args: ["-y", "mcp-gone@1.0.0"] },
      },
    })
    const after = readGolden("safe-time.json")
    const base = buildBaseline(scan(before), AT)
    const drift = computeDrift(base, scan(after), AT)
    expect(drift.entries.find((e) => e.server === "gone")!.status).toBe("removed")
  })

  it("baseline is deterministic and carries the schema version", () => {
    const text = readGolden("review-github.json")
    const base = buildBaseline(scan(text), AT)
    expect(base.schemaVersion).toBe("mcpguard.baseline.v0")
    expect(base.entries[0]!.fingerprints.configHash).toMatch(/^sha256:/)
  })
})
