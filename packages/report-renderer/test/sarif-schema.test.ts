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
    target: {
      name: "test-server",
      configPath: "test/mcp.json",
    },
    verdict: "REVIEW",
    findings: [
      {
        id: "test.finding",
        title: "Test finding",
        severity: "medium",
        blocker: false,
        symbol: "TEST",
        riskClass: "S1",
        mode: "OBSERVED",
        confidence: "high",
        detectionMethod: "config",
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
    fingerprints: {
      configHash: "abc123",
      targetHash: "def456",
      packageHash: null,
      riskSurfaceHash: "ghi789",
    },
    summary: {
      blocker: 0,
      critical: 0,
      high: 0,
      medium: 1,
      low: 0,
      info: 0,
    },
    timestamp: "2024-01-01T00:00:00.000Z",
    toolVersion: "1.0.0",
    runtimeBinding: {
      kind: "npm",
      packageName: "test-package",
      packageVersion: "1.0.0",
      command: "node",
      args: [],
      env: {},
      transport: "stdio",
    },
  }

  const mockReport: ConfigSummaryReport = {
    configPath: "test/mcp.json",
    reports: [mockScanReport],
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
    expect(result.properties.symbol).toBe("TEST")
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
    const multiReport: ConfigSummaryReport = {
      configPath: "test/mcp.json",
      reports: [
        {
          ...mockScanReport,
          findings: [
            mockScanReport.findings[0],
            {
              ...mockScanReport.findings[0],
              id: "test.finding2",
              title: "Second finding",
              severity: "critical",
            },
          ],
        },
      ],
    }

    const sarif = renderSarif(multiReport)
    const parsed = JSON.parse(sarif)

    expect(parsed.runs[0].results).toHaveLength(2)
    expect(parsed.runs[0].tool.driver.rules).toHaveLength(2)

    // Critical severity should map to error level
    const criticalResult = parsed.runs[0].results.find(
      (r: any) => r.ruleId === "test.finding2",
    )
    expect(criticalResult.level).toBe("error")
  })

  it("handles findings without line numbers", () => {
    const noLineReport: ConfigSummaryReport = {
      configPath: "test/mcp.json",
      reports: [
        {
          ...mockScanReport,
          findings: [
            {
              ...mockScanReport.findings[0],
              evidence: [
                {
                  type: "config",
                  path: "test/mcp.json",
                  key: "test",
                  value: "value",
                  // no line number
                },
              ],
            },
          ],
        },
      ],
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
    const schema = await response.json()

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
