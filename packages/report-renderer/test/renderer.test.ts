import { describe, it, expect } from "vitest"
import {
  renderJson,
  renderTerminal,
  renderCompact,
  renderExplain,
  NO_EMOJI_STYLE,
} from "../src/index.js"
import { scanConfigFile } from "@mcpguard/core"
import { goldenPath } from "@mcpguard/fixtures"

const OPTS = { now: Date.parse("2026-06-01T00:00:00Z"), generatedAt: "2026-06-01T00:00:00.000Z" }

describe("json renderer", () => {
  it("is valid JSON and emoji-free", () => {
    const s = scanConfigFile(goldenPath("block-filesystem.json"), OPTS)
    const out = renderJson(s)
    expect(() => JSON.parse(out)).not.toThrow()
    // no emoji code points
    expect(/\p{Extended_Pictographic}/u.test(out)).toBe(false)
    expect(JSON.parse(out).verdict).toBe("BLOCK")
  })
})

describe("terminal renderer", () => {
  it("shows verdict, server name, and a blocker finding", () => {
    const s = scanConfigFile(goldenPath("block-filesystem.json"), OPTS)
    const out = renderTerminal(s)
    expect(out).toContain("BLOCK")
    expect(out).toContain("filesystem")
    expect(out).toContain("BLOCKER")
    expect(out).toContain("fix:")
  })

  it("no-emoji style omits emoji", () => {
    const s = scanConfigFile(goldenPath("block-filesystem.json"), OPTS)
    const out = renderTerminal(s, NO_EMOJI_STYLE)
    expect(/\p{Extended_Pictographic}/u.test(out)).toBe(false)
    expect(out).toContain("BLOCK")
  })
})

describe("compact renderer", () => {
  it("one line per server plus total", () => {
    const s = scanConfigFile(goldenPath("review-github.json"), OPTS)
    const out = renderCompact(s, NO_EMOJI_STYLE)
    const lines = out.split("\n")
    expect(lines.length).toBe(2) // one server + total
    expect(lines[0]).toContain("github")
    expect(lines[1]).toContain("TOTAL")
  })
})

describe("explain renderer", () => {
  it("renders full evidence and fingerprints", () => {
    const s = scanConfigFile(goldenPath("block-prompt-poison.json"), OPTS)
    const out = renderExplain(s.reports[0]!, NO_EMOJI_STYLE)
    expect(out).toContain("Findings")
    expect(out).toContain("prompt.poisoning")
    expect(out).toContain("evidence:")
    expect(out).toContain("Fingerprints")
    expect(out).toContain("sha256:")
  })

  it("safe server explains with no findings", () => {
    const s = scanConfigFile(goldenPath("safe-time.json"), OPTS)
    const out = renderExplain(s.reports[0]!, NO_EMOJI_STYLE)
    expect(out).toContain("No findings.")
  })
})
