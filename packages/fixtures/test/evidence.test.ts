import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { describe, it, expect } from "vitest"
import { importEvidence, type EvidenceEnvelope } from "@calllint/evidence"

/**
 * new7 Phase B / v1.2.0 — Evidence fixture validation (ADR 0034).
 *
 * Drives the REAL fixture files through `importEvidence` and asserts the
 * envelope invariants end-to-end (not inline strings). This ties the golden
 * inputs to the adapter and gives the B4 benchmark a proven loader.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SS_DIR = join(here, "..", "evidence", "skillspector")

function load(name: string): string {
  return readFileSync(join(SS_DIR, name), "utf-8")
}

/** Structural conformance to calllint.evidence-provider.v0. */
function assertEnvelopeShape(env: EvidenceEnvelope): void {
  expect(env.schema_version).toBe("calllint.evidence-provider.v0")
  expect(typeof env.provider).toBe("string")
  expect(typeof env.providerVersion).toBe("string")
  expect(env.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  expect(env.rawReportDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  expect(["static", "llm", "deep"]).toContain(env.scanMode)
  expect(["complete", "partial", "degraded", "failed"]).toContain(env.completeness)
  expect(Array.isArray(env.findings)).toBe(true)
  expect(Array.isArray(env.degradedReasons)).toBe(true)
  // Invariant: a non-empty degradedReasons implies completeness is not "complete".
  if (env.degradedReasons.length > 0) expect(env.completeness).not.toBe("complete")
  // Invariant: CallLint never writes its own verdict into the envelope.
  expect(env).not.toHaveProperty("verdict")
  // Invariant: provider findings keep provider-native ids/severities (no S0-S5).
  for (const f of env.findings) {
    expect(typeof f.providerRuleId).toBe("string")
    expect(typeof f.providerSeverity).toBe("string")
  }
}

describe("evidence fixtures — every file imports to a valid envelope", () => {
  const files = readdirSync(SS_DIR).filter((f) => f.endsWith(".json") || f.endsWith(".sarif"))

  it("has the expected fixture set", () => {
    expect(files.sort()).toEqual(
      ["clean.json", "findings.json", "malformed.json", "partial.json", "report.sarif"].sort()
    )
  })

  for (const file of files) {
    it(`${file} → valid envelope shape`, () => {
      const fmt = file.endsWith(".sarif") ? ("sarif" as const) : undefined
      assertEnvelopeShape(importEvidence(load(file), { format: fmt }))
    })
  }
})

describe("evidence fixtures — per-file expected outcomes (ADR 0034)", () => {
  it("clean.json → complete, no findings", () => {
    const env = importEvidence(load("clean.json"))
    expect(env.provider).toBe("skillspector")
    expect(env.completeness).toBe("complete")
    expect(env.findings).toHaveLength(0)
  })

  it("findings.json → llm scan, findings preserved verbatim", () => {
    const env = importEvidence(load("findings.json"))
    expect(env.scanMode).toBe("llm")
    expect(env.findings.map((f) => f.providerRuleId)).toEqual(["SS-EXFIL-001", "SS-EVAL-002"])
    expect(env.findings.map((f) => f.providerSeverity)).toEqual(["high", "critical"])
  })

  it("partial.json → partial (REVIEW-class)", () => {
    expect(importEvidence(load("partial.json")).completeness).toBe("partial")
  })

  it("malformed.json → failed (fail-closed, never a pass)", () => {
    const env = importEvidence(load("malformed.json"))
    expect(env.completeness).toBe("failed")
    expect(env.findings).toHaveLength(0)
    expect(env.degradedReasons.length).toBeGreaterThan(0)
  })

  it("report.sarif → findings mapped, degraded (SARIF detail loss)", () => {
    const env = importEvidence(load("report.sarif"), { format: "sarif" })
    expect(env.findings[0]?.providerRuleId).toBe("SS-EXFIL-001")
    expect(env.completeness).toBe("degraded")
  })
})
