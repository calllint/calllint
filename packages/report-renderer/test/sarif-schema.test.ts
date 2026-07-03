import { describe, it, expect } from "vitest"
import Ajv from "ajv"
import { renderSarif } from "../src/renderSarif.js"
import type { ConfigSummaryReport, ScanReport } from "@calllint/types"

/**
 * SARIF 2.1.0 schema validation test.
 *
 * Validates that our SARIF output conforms to the official SARIF specification.
 * This ensures compatibility with GitHub Code Scanning and other SARIF consumers.
 */

// Official SARIF 2.1.0 schema URL
const SARIF_SCHEMA_URL = "https://json.schemastore.org/sarif-2.1.0.json"

describe("SARIF output validation", () => {
  const mockScanReport: ScanReport = {
    schemaVersion: "calllint.report.v0",
    reportKind: "single-target",
    target: {
      name: "test-server",
      kind: "cursor-mcp-config",
      configPath: "test/mcp.json",
    },
    verdict: "REVIEW",
    publicVerdictLabel: "Review required",
    riskClass: "S1",
    symbols: ["NETWORK"],
    confidence: "high",
    reproducibility: { level: "HIGH", reasons: [] },
    summary: "Test server summary",
    observed: [],
    inferred: [],
    findings: [
      {
        id: "test.finding",
        title: "Test finding",
        severity: "medium",
        blocker: false,
        symbol: "NETWORK",
        riskClass: "S1",
        mode: "OBSERVED",
        confidence: "high",
        detectionMethod: "config-analysis",
        evidence: [
          {
            type: "config",
            path: "test/mcp.json",
            key: "test",
            value: "value",
            line: 10,
          },
        ],
        impact: "This is a test finding impact",
        fix: "This is a test fix",
        falsePositiveNote: "This is a test note",
      },
    ],
    topFindings: [],
    policy: {
      autonomousUse: "warn",
      manualApproval: "recommended",
      sandbox: "none",
    },
    fingerprints: {
      configHash: "abc123",
      targetSpecHash: "def456",
      riskSurfaceHash: "ghi789",
    },
    diagnostics: [],
    generatedAt: "2024-01-01T00:00:00.000Z",
  }

  const mockReport: ConfigSummaryReport = {
    schemaVersion: "calllint.report.v0",
    reportKind: "config-summary",
    configPath: "test/mcp.json",
    verdict: "REVIEW",
    publicVerdictLabel: "Review required",
    counts: { SAFE: 0, REVIEW: 1, BLOCK: 0, UNKNOWN: 0 },
    reports: [mockScanReport],
    diagnostics: [],
    generatedAt: "2024-01-01T00:00:00.000Z",
  }

  it("produces valid SARIF 2.1.0 JSON structure", () => {
    const sarif = renderSarif(mockReport)
    const parsed = JSON.parse(sarif)

    // Basic structure validation
    expect(parsed.version).toBe("2.1.0")
    expect(parsed.$schema).toBe(
      "https://json.schemastore.org/sarif-2.1.0.json",
    )
    expect(parsed.runs).toBeDefined()
    expect(parsed.runs).toHaveLength(1)

    const run = parsed.runs[0]
    expect(run.tool).toBeDefined()
    expect(run.tool.driver).toBeDefined()
    expect(run.tool.driver.name).toBe("CallLint")
    expect(run.results).toBeDefined()
    expect(run.results).toHaveLength(1)

    // Result structure
    const result = run.results[0]
    expect(result.ruleId).toBe("test.finding")
    expect(result.level).toBe("warning") // medium severity → warning
    expect(result.message).toBeDefined()
    expect(result.message.text).toContain("This is a test finding impact")
    expect(result.locations).toBeDefined()
    expect(result.locations).toHaveLength(1)

    // Location structure
    const location = result.locations[0]
    expect(location.physicalLocation).toBeDefined()
    expect(location.physicalLocation.artifactLocation).toBeDefined()
    expect(location.physicalLocation.artifactLocation.uri).toBe("test/mcp.json")
    expect(location.physicalLocation.region).toBeDefined()
    expect(location.physicalLocation.region.startLine).toBe(10)

    // Properties
    expect(result.properties).toBeDefined()
    expect(result.properties.verdict).toBe("REVIEW")
    expect(result.properties.symbol).toBe("NETWORK")
    expect(result.properties.riskClass).toBe("S1")
  })

  it("includes rules in the driver", () => {
    const sarif = renderSarif(mockReport)
    const parsed = JSON.parse(sarif)
    const driver = parsed.runs[0].tool.driver

    expect(driver.rules).toBeDefined()
    expect(driver.rules).toHaveLength(1)

    const rule = driver.rules[0]
    expect(rule.id).toBe("test.finding")
    expect(rule.name).toBe("Test finding")
    expect(rule.shortDescription).toBeDefined()
    expect(rule.shortDescription.text).toBe("Test finding")
    expect(rule.fullDescription).toBeDefined()
    expect(rule.fullDescription.text).toBe("This is a test finding impact")
    expect(rule.defaultConfiguration).toBeDefined()
    expect(rule.defaultConfiguration.level).toBe("warning")
  })

  it("handles multiple findings correctly", () => {
    const baseFinding = mockScanReport.findings[0]
    if (!baseFinding) throw new Error("Base finding is required")

    const finding2: ScanReport["findings"][0] = {
      id: "test.finding2",
      title: "Second finding",
      severity: "critical",
      blocker: true,
      symbol: "EXEC",
      riskClass: "S4",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "config-analysis",
      evidence: [
        {
          type: "config",
          path: "test/mcp.json",
          key: "test2",
          value: "value2",
        },
      ],
      impact: "Critical impact",
      fix: "Fix it",
    }

    const multiReport: ConfigSummaryReport = {
      schemaVersion: "calllint.report.v0",
      reportKind: "config-summary",
      configPath: "test/mcp.json",
      verdict: "BLOCK",
      publicVerdictLabel: "Dangerous surface",
      counts: { SAFE: 0, REVIEW: 0, BLOCK: 1, UNKNOWN: 0 },
      reports: [
        {
          ...mockScanReport,
          findings: [baseFinding, finding2],
          verdict: "BLOCK",
          publicVerdictLabel: "Dangerous surface",
        },
      ],
      diagnostics: [],
      generatedAt: "2024-01-01T00:00:00.000Z",
    }

    const sarif = renderSarif(multiReport)
    const parsed = JSON.parse(sarif)

    expect(parsed.runs[0].results).toHaveLength(2)
    expect(parsed.runs[0].tool.driver.rules).toHaveLength(2)

    // Critical severity should map to error level
    const criticalResult = parsed.runs[0].results.find(
      (r: any) => r.ruleId === "test.finding2",
    )
    expect(criticalResult).toBeDefined()
    expect(criticalResult.level).toBe("error")
  })

  it("handles findings without line numbers", () => {
    const findingNoLine: ScanReport["findings"][0] = {
      id: "test.finding",
      title: "Test finding",
      severity: "medium",
      blocker: false,
      symbol: "NETWORK",
      riskClass: "S1",
      mode: "OBSERVED",
      confidence: "high",
      detectionMethod: "config-analysis",
      evidence: [
        {
          type: "config",
          path: "test/mcp.json",
          key: "test",
          value: "value",
          // no line number
        },
      ],
      impact: "This is a test finding impact",
      fix: "This is a test fix",
    }

    const noLineReport: ConfigSummaryReport = {
      schemaVersion: "calllint.report.v0",
      reportKind: "config-summary",
      configPath: "test/mcp.json",
      verdict: "REVIEW",
      publicVerdictLabel: "Review required",
      counts: { SAFE: 0, REVIEW: 1, BLOCK: 0, UNKNOWN: 0 },
      reports: [
        {
          ...mockScanReport,
          findings: [findingNoLine],
        },
      ],
      diagnostics: [],
      generatedAt: "2024-01-01T00:00:00.000Z",
    }

    const sarif = renderSarif(noLineReport)
    const parsed = JSON.parse(sarif)
    const result = parsed.runs[0].results[0]

    // Should still have location, but no region
    expect(result.locations[0].physicalLocation.artifactLocation.uri).toBe(
      "test/mcp.json",
    )
    expect(result.locations[0].physicalLocation.region).toBeUndefined()
  })

  it("includes fingerprints for deduplication", () => {
    const sarif = renderSarif(mockReport)
    const parsed = JSON.parse(sarif)
    const result = parsed.runs[0].results[0]

    expect(result.partialFingerprints).toBeDefined()
    expect(result.partialFingerprints.configHash).toBe("abc123")
    expect(result.partialFingerprints.riskSurfaceHash).toBe("ghi789")
  })

  // Schema validation test - skipped by default as it requires network access
  it.skip("validates against official SARIF 2.1.0 schema", async () => {
    const ajv = new Ajv({ strict: false, allErrors: true })

    // Fetch schema
    const response = await fetch(SARIF_SCHEMA_URL)
    const schema = (await response.json()) as object

    const validate = ajv.compile(schema)
    const sarif = renderSarif(mockReport)
    const parsed = JSON.parse(sarif)

    const valid = validate(parsed)

    if (!valid) {
      console.error("SARIF validation errors:", validate.errors)
    }

    expect(valid).toBe(true)
  })
})
