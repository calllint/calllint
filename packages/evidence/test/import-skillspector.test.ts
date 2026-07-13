import { describe, it, expect } from "vitest"
import { importEvidence } from "../src/index.js"

/**
 * Locks the ADR 0034 import invariants for the SkillSpector adapter:
 *  1. no re-score / no rename (provider findings verbatim)
 *  3. fail closed (malformed → completeness:"failed", never a pass)
 *  4. never silently ignore (unknown provider / empty → surfaced, not dropped)
 *  5. pin version (missing version ⇒ "unknown" + degraded)
 * Invariant 2 (no upgrade of the CallLint verdict) is a consumer-boundary concern
 * covered where evidence is attached to a scan, not in the importer.
 */

const clean = JSON.stringify({
  scanner: "SkillSpector",
  commit: "a".repeat(40),
  status: "complete",
  categories: ["malicious-patterns", "taint"],
  findings: [],
})

const withFindings = JSON.stringify({
  scanner: "SkillSpector",
  commit: "b".repeat(40),
  status: "complete",
  llm_used: true,
  findings: [
    { rule_id: "SS-EXFIL-001", severity: "high", message: "possible exfil", location: "handler.py:42" },
    { rule_id: "SS-EVAL-002", severity: "critical", message: "eval of input" },
  ],
})

const degraded = JSON.stringify({
  scanner: "SkillSpector",
  commit: "c".repeat(40),
  status: "partial",
  findings: [{ rule_id: "SS-X", severity: "low" }],
})

const noVersion = JSON.stringify({
  scanner: "SkillSpector",
  status: "complete",
  findings: [],
})

describe("importEvidence — SkillSpector JSON", () => {
  it("clean report → complete, no findings, no CallLint verdict written", () => {
    const env = importEvidence(clean)
    expect(env.schema_version).toBe("calllint.evidence-provider.v0")
    expect(env.provider).toBe("skillspector")
    expect(env.providerVersion).toBe(`git:${"a".repeat(40)}`)
    expect(env.completeness).toBe("complete")
    expect(env.findings).toEqual([])
    // The envelope must NOT carry a CallLint SAFE/REVIEW/BLOCK/UNKNOWN verdict.
    expect(env).not.toHaveProperty("verdict")
  })

  it("findings are preserved verbatim (no severity remap, no rule rename)", () => {
    const env = importEvidence(withFindings)
    expect(env.scanMode).toBe("llm") // llm_used:true is decision-relevant
    expect(env.findings).toHaveLength(2)
    expect(env.findings[0]).toMatchObject({
      providerRuleId: "SS-EXFIL-001",
      providerSeverity: "high", // provider-native string, NOT mapped to S0-S5
      locations: ["handler.py:42"],
    })
    expect(env.findings[1]?.providerSeverity).toBe("critical")
  })

  it("provider-declared partial scan → partial (REVIEW-class), reason surfaced", () => {
    const env = importEvidence(degraded)
    expect(env.completeness).toBe("partial")
    expect(env.degradedReasons.join(" ")).toMatch(/partial/i)
  })

  it("missing provider version → 'unknown' + degraded (invariant 5)", () => {
    const env = importEvidence(noVersion)
    expect(env.providerVersion).toBe("unknown")
    expect(env.completeness).not.toBe("complete")
    expect(env.degradedReasons.join(" ")).toMatch(/version/i)
  })

  it("malformed JSON → fail closed (completeness:failed), never throws", () => {
    const env = importEvidence("{ not valid json ")
    expect(env.completeness).toBe("failed")
    expect(env.findings).toEqual([])
    expect(env.degradedReasons.length).toBeGreaterThan(0)
  })

  it("unknown provider → fail closed, evidence surfaced not dropped", () => {
    const env = importEvidence(JSON.stringify({ scanner: "MysteryTool", findings: [] }))
    expect(env.completeness).toBe("failed")
    expect(env.degradedReasons.join(" ")).toMatch(/no adapter/i)
    // rawReportDigest is still computed → provenance preserved even on failure.
    expect(env.rawReportDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it("same raw input → same rawReportDigest (deterministic, fingerprint reuse)", () => {
    expect(importEvidence(clean).rawReportDigest).toBe(importEvidence(clean).rawReportDigest)
  })
})

describe("importEvidence — SkillSpector SARIF", () => {
  const sarif = JSON.stringify({
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "SkillSpector", semanticVersion: "2.0.0" } },
        results: [
          {
            ruleId: "SS-EXFIL-001",
            level: "error",
            message: { text: "possible exfil" },
            locations: [
              { physicalLocation: { artifactLocation: { uri: "handler.py" }, region: { startLine: 42 } } },
            ],
          },
        ],
      },
    ],
  })

  it("maps SARIF results verbatim and flags detail loss as degraded", () => {
    const env = importEvidence(sarif, { format: "sarif" })
    expect(env.provider).toBe("skillspector")
    expect(env.providerVersion).toBe("2.0.0")
    expect(env.findings[0]).toMatchObject({
      providerRuleId: "SS-EXFIL-001",
      providerSeverity: "error",
      locations: ["handler.py:42"],
    })
    // SARIF is known to drop detail vs JSON → must be marked degraded, not complete.
    expect(env.completeness).toBe("degraded")
    expect(env.degradedReasons.join(" ")).toMatch(/SARIF/i)
  })
})
