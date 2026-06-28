import { describe, it, expect } from "vitest"
import type { Finding } from "@calllint/types"
import { findingsToReasonCodes } from "../src/rules/reasonCodes.js"
import { sparseDecision } from "../src/rules/sparseRules.js"
import { toCompactDecision } from "../src/decision/decide.js"
import { scanConfigText } from "../src/index.js"

const OPTS = {
  now: Date.parse("2026-06-01T00:00:00Z"),
  generatedAt: "2026-06-01T00:00:00.000Z",
}

/** Minimal finding stub for mapping tests. */
function finding(id: string, symbol: Finding["symbol"]): Finding {
  return {
    id,
    title: id,
    severity: "medium",
    blocker: false,
    symbol,
    riskClass: "S2",
    mode: "OBSERVED",
    confidence: "high",
    detectionMethod: "config-analysis",
    evidence: [],
    impact: "",
    fix: "",
  }
}

describe("findingsToReasonCodes (P1.2 / ADR 0020)", () => {
  it("maps the detector ids to reason codes, deduped, in frozen order", () => {
    const findings = [
      finding("action.financial", "MONEY"),
      finding("supply.unpinned-package", "SUPPLY"),
      finding("action.financial-observed", "MONEY"), // folds to same code
      finding("files.broad-path", "FILES"),
    ]
    expect(findingsToReasonCodes(findings)).toEqual([
      // REASON_CODES declaration order: UNPINNED, FILES, MONEY
      "UNPINNED_PACKAGE",
      "BROAD_FILESYSTEM_ACCESS",
      "MONEY_OR_PAYMENT_CAPABILITY",
    ])
  })

  it("ignores unmapped findings (mapping is by id, not symbol)", () => {
    // id is what maps; an unmapped id yields nothing regardless of symbol.
    expect(findingsToReasonCodes([finding("not.a.code", "FILES")])).toEqual([])
    expect(findingsToReasonCodes([finding("totally.unknown", "RUGPULL")])).toEqual([])
    // a mapped id maps even if mixed with unmapped ones
    expect(
      findingsToReasonCodes([
        finding("not.a.code", "FILES"),
        finding("files.broad-path", "FILES"),
      ]),
    ).toEqual(["BROAD_FILESYSTEM_ACCESS"])
  })
})

describe("sparseDecision (P1.3 / ADR 0020)", () => {
  it("passes the verdict through and derives nextAction", () => {
    expect(sparseDecision("SAFE", []).nextAction).toBe("continue")
    expect(sparseDecision("REVIEW", []).nextAction).toBe("ask_before_continue")
    expect(sparseDecision("BLOCK", []).nextAction).toBe("stop")
  })

  it("UNKNOWN never maps to continue", () => {
    const d = sparseDecision("UNKNOWN", [])
    expect(d.nextAction).toBe("gather_more_evidence")
    expect(d.nextAction).not.toBe("continue")
  })
})

describe("toCompactDecision (P1.4 / ADR 0020)", () => {
  it("projects a real ScanReport into a compact decision", () => {
    const text = JSON.stringify({
      mcpServers: {
        fs: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/x"],
        },
      },
    })
    const summary = scanConfigText(text, ".cursor/mcp.json", OPTS)
    const report = summary.reports[0]!
    const decision = toCompactDecision(report, ".cursor/mcp.json")

    expect(decision.schemaVersion).toBe("calllint.decision.v0")
    expect(decision.verdict).toBe(report.verdict)
    expect(decision.surface).toBe(".cursor/mcp.json")
    // verdict→nextAction stays consistent with the table
    if (report.verdict === "SAFE") expect(decision.nextAction).toBe("continue")
    else expect(decision.nextAction).not.toBe("continue")
  })
})
