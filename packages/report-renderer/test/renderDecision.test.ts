import { describe, it, expect } from "vitest"
import type { CompactDecision } from "@calllint/types"
import {
  renderDecision,
  renderDecisionTable,
} from "../src/renderDecision.js"
import { NO_EMOJI_STYLE } from "../src/style.js"

function decision(over: Partial<CompactDecision> = {}): CompactDecision {
  return {
    schemaVersion: "calllint.decision.v0",
    verdict: "REVIEW",
    surface: ".cursor/mcp.json",
    fingerprintHash: "sha256:abc",
    reasonCodes: ["UNPINNED_PACKAGE", "EXTERNAL_MUTATION_UNKNOWN"],
    nextAction: "ask_before_continue",
    ...over,
  }
}

describe("renderDecision (P1.7 compact)", () => {
  it("renders a tidy ≤30-line block with verdict, reasons, next action", () => {
    const out = renderDecision(decision())
    const lines = out.split("\n")
    expect(lines.length).toBeLessThanOrEqual(30)
    expect(out).toContain("REVIEW")
    expect(out).toContain("UNPINNED_PACKAGE, EXTERNAL_MUTATION_UNKNOWN")
    expect(out).toContain("Next:")
  })

  it("handles no reason codes", () => {
    const out = renderDecision(decision({ verdict: "SAFE", reasonCodes: [], nextAction: "continue" }))
    expect(out).toContain("Reasons: none observed")
  })

  it("no-emoji style is plain text", () => {
    const out = renderDecision(decision(), NO_EMOJI_STYLE)
    expect(out).toContain("REVIEW")
    // text symbol is the verdict word itself, no emoji glyph
    expect(out).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  })
})

describe("renderDecisionTable (P1.7 scan-all)", () => {
  it("reports a count header and one line per surface", () => {
    const out = renderDecisionTable([
      decision({ surface: ".cursor/mcp.json" }),
      decision({ verdict: "SAFE", surface: ".vscode/mcp.json", reasonCodes: [], nextAction: "continue" }),
    ])
    expect(out).toContain("2 agent-tool surfaces found")
    expect(out).toContain(".cursor/mcp.json")
    expect(out).toContain("no blockers observed")
  })

  it("handles the empty case", () => {
    expect(renderDecisionTable([])).toBe("0 agent-tool surfaces found")
  })
})
