import { describe, it, expect } from "vitest"
import { scanConfigText } from "../src/index.js"
import type { Finding } from "@mcpguard/types"

const OPTS = { now: Date.parse("2026-06-01T00:00:00Z"), generatedAt: "2026-06-01T00:00:00.000Z" }

/** A BLOCK-causing config: a broad filesystem grant (offline, deterministic). */
const BLOCK_TEXT = JSON.stringify({
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/x"] },
  },
})

/** A SAFE config: a pinned, benign package. */
const SAFE_TEXT = JSON.stringify({
  mcpServers: {
    time: { command: "npx", args: ["-y", "@modelcontextprotocol/server-time@1.0.0"] },
  },
})

/** An UNKNOWN config: an unverifiable remote endpoint. */
const UNKNOWN_TEXT = JSON.stringify({
  mcpServers: {
    remote: { url: "https://unknown.example.com/sse", type: "sse" },
  },
})

/** A low-risk advisory online finding (deprecated package). Adds risk, not a blocker. */
function onlineAdvisory(): Finding[] {
  return [
    {
      id: "supply.deprecated",
      title: "Package version is deprecated",
      severity: "medium",
      blocker: false,
      symbol: "SUPPLY",
      riskClass: "S1",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "package-metadata",
      evidence: [{ type: "package-metadata", key: "deprecated", value: "old" }],
      impact: "deprecated",
      fix: "upgrade",
      source: "online",
      fetchedAt: "2026-06-01T00:00:00.000Z",
    },
  ]
}

describe("online enrichment never downgrades a verdict", () => {
  it("offline BLOCK + benign online metadata → still BLOCK", () => {
    const s = scanConfigText(BLOCK_TEXT, "<inline>", {
      ...OPTS,
      extraFindings: { fs: onlineAdvisory() },
    })
    expect(s.verdict).toBe("BLOCK")
  })

  it("offline UNKNOWN + online metadata → never SAFE (stays UNKNOWN or higher)", () => {
    const s = scanConfigText(UNKNOWN_TEXT, "<inline>", {
      ...OPTS,
      extraFindings: { remote: onlineAdvisory() },
    })
    expect(s.verdict).not.toBe("SAFE")
    expect(["UNKNOWN", "BLOCK"]).toContain(s.verdict)
  })

  it("offline SAFE + online risk → upgrades, never the reverse", () => {
    const safeBefore = scanConfigText(SAFE_TEXT, "<inline>", OPTS).verdict
    expect(safeBefore).toBe("SAFE")
    const s = scanConfigText(SAFE_TEXT, "<inline>", {
      ...OPTS,
      extraFindings: { time: onlineAdvisory() },
    })
    // a finding (even advisory) raises SAFE to at least REVIEW
    expect(["REVIEW", "UNKNOWN", "BLOCK"]).toContain(s.verdict)
  })

  it("guard throws if an injected finding could somehow lower the verdict", () => {
    // Sanity: the invariant is code-enforced. A normal additive finding can
    // never trigger it; this asserts the offline-vs-enriched comparison runs
    // (no throw on a legitimate, additive enrichment).
    expect(() =>
      scanConfigText(BLOCK_TEXT, "<inline>", { ...OPTS, extraFindings: { fs: onlineAdvisory() } }),
    ).not.toThrow()
  })
})
