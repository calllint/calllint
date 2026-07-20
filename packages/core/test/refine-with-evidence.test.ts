import { describe, it, expect } from "vitest"
import type { ConfigSummaryReport, ScanReport, Verdict } from "@calllint/types"
import type { EvidenceBundle, ResolutionState } from "@calllint/evidence"
import {
  refineSummaryWithEvidence,
  REMOTE_UNVERIFIED_REASON,
  REMOTE_SURFACE_UNANALYZED_REASON,
  REMOTE_OWNER_UNVERIFIED_REASON,
} from "../src/refineWithEvidence.js"
import { makeGap } from "@calllint/evidence"

const URL = "https://sh.inference.ac"

function remoteReport(verdict: Verdict, reasons: string[]): ScanReport {
  return {
    schemaVersion: "calllint.report.v0",
    reportKind: "single-target",
    target: { name: "remote-1", kind: "cursor-mcp-config", source: URL },
    verdict,
    publicVerdictLabel: verdict,
    riskClass: "S1",
    symbols: [],
    confidence: "high",
    reproducibility: { level: reasons.length === 1 ? "MEDIUM" : "LOW", reasons },
    summary: "s",
    observed: [],
    inferred: [],
    findings: [],
    topFindings: [],
    policy: { autonomousUse: "deny", manualApproval: "required", sandbox: "required" },
    fingerprints: {} as ScanReport["fingerprints"],
    diagnostics: [],
    generatedAt: "2026-07-20T00:00:00.000Z",
  }
}

function summary(reports: ScanReport[]): ConfigSummaryReport {
  const counts = { SAFE: 0, REVIEW: 0, BLOCK: 0, UNKNOWN: 0 }
  for (const r of reports) counts[r.verdict]++
  return {
    schemaVersion: "calllint.report.v0",
    reportKind: "config-summary",
    configPath: "p",
    verdict: reports[0]?.verdict ?? "UNKNOWN",
    publicVerdictLabel: "x",
    counts,
    reports,
    diagnostics: [],
    generatedAt: "2026-07-20T00:00:00.000Z",
  }
}

function bundle(state: ResolutionState, gaps: EvidenceBundle["gaps"] = []): EvidenceBundle {
  return {
    schema: "calllint.evidence-bundle.v0",
    subject: { schema: "calllint.evidence-subject.v0", subjectType: "remote-endpoint", id: URL },
    state,
    items: [{ field: "endpoint.url", value: URL, tier: "repository", source: "R6:remote" }],
    gaps,
  }
}

const cleanBundle = bundle("COMPLETE")

describe("refineSummaryWithEvidence (ADR 0050 — gap-close + re-derive)", () => {
  it("lifts UNKNOWN-by-unverified-remote to REVIEW when identity resolves cleanly", () => {
    const s = summary([remoteReport("UNKNOWN", [REMOTE_UNVERIFIED_REASON])])
    const out = refineSummaryWithEvidence(s, new Map([[URL, cleanBundle]]))
    expect(out.verdict).toBe("REVIEW")
    expect(out.reports[0]!.verdict).toBe("REVIEW")
    expect(out.reports[0]!.reproducibility.reasons).toContain(REMOTE_SURFACE_UNANALYZED_REASON)
    expect(out.reports[0]!.reproducibility.reasons).not.toContain(REMOTE_UNVERIFIED_REASON)
    expect(out.counts).toMatchObject({ REVIEW: 1, UNKNOWN: 0 })
    expect(out.reports[0]!.diagnostics.some((d) => d.code === "evidence.remote-identity-verified")).toBe(true)
  })

  it("INVARIANT: evidence NEVER produces SAFE from an UNKNOWN", () => {
    for (const st of ["COMPLETE", "PARTIAL", "UNRESOLVABLE", "RETRYABLE_FAILURE"] as ResolutionState[]) {
      const out = refineSummaryWithEvidence(
        summary([remoteReport("UNKNOWN", [REMOTE_UNVERIFIED_REASON])]),
        new Map([[URL, bundle(st)]]),
      )
      expect(out.verdict).not.toBe("SAFE")
      expect(out.reports[0]!.verdict).not.toBe("SAFE")
    }
  })

  it("PARTIAL with ONLY a degrading owner gap lifts to REVIEW (the real registry case)", () => {
    const ownerGap = makeGap("REMOTE_OWNER_UNVERIFIED", "no .well-known/mcp.json", {
      missingFields: ["endpoint.owner"],
    })
    const s = summary([remoteReport("UNKNOWN", [REMOTE_UNVERIFIED_REASON])])
    const out = refineSummaryWithEvidence(s, new Map([[URL, bundle("PARTIAL", [ownerGap])]]))
    expect(out.reports[0]!.verdict).toBe("REVIEW")
    expect(out.reports[0]!.reproducibility.reasons).toContain(REMOTE_OWNER_UNVERIFIED_REASON)
    expect(out.reports[0]!.reproducibility.reasons).toContain(REMOTE_SURFACE_UNANALYZED_REASON)
  })

  it("does NOT refine when a BLOCKING network gap is present (unreachable)", () => {
    const netGap = makeGap("NETWORK_UNAVAILABLE", "upstream unreachable")
    const s = summary([remoteReport("UNKNOWN", [REMOTE_UNVERIFIED_REASON])])
    const out = refineSummaryWithEvidence(s, new Map([[URL, bundle("PARTIAL", [netGap])]]))
    expect(out.reports[0]!.verdict).toBe("UNKNOWN")
  })

  it("does NOT refine a RETRYABLE_FAILURE or UNRESOLVABLE bundle (fail-closed)", () => {
    for (const st of ["RETRYABLE_FAILURE", "UNRESOLVABLE"] as ResolutionState[]) {
      const s = summary([remoteReport("UNKNOWN", [REMOTE_UNVERIFIED_REASON])])
      const out = refineSummaryWithEvidence(s, new Map([[URL, bundle(st)]]))
      expect(out.reports[0]!.verdict).toBe("UNKNOWN")
    }
  })

  it("does NOT refine when network identity (endpoint.url) is absent", () => {
    const noUrl: EvidenceBundle = { ...cleanBundle, items: [] }
    const s = summary([remoteReport("UNKNOWN", [REMOTE_UNVERIFIED_REASON])])
    const out = refineSummaryWithEvidence(s, new Map([[URL, noUrl]]))
    expect(out.reports[0]!.verdict).toBe("UNKNOWN")
  })

  it("leaves a BLOCK report byte-identical even with a clean bundle", () => {
    const block = summary([remoteReport("BLOCK", [REMOTE_UNVERIFIED_REASON])])
    const out = refineSummaryWithEvidence(block, new Map([[URL, cleanBundle]]))
    expect(out.reports[0]).toEqual(block.reports[0])
    expect(out.verdict).toBe("BLOCK")
  })

  it("leaves a SAFE report untouched", () => {
    const safe = summary([remoteReport("SAFE", [])])
    const out = refineSummaryWithEvidence(safe, new Map([[URL, cleanBundle]]))
    expect(out.reports[0]!.verdict).toBe("SAFE")
  })

  it("empty bundle map ⇒ input returned unchanged", () => {
    const s = summary([remoteReport("UNKNOWN", [REMOTE_UNVERIFIED_REASON])])
    expect(refineSummaryWithEvidence(s, new Map())).toBe(s)
  })

  it("no matching bundle for the report's source ⇒ stays UNKNOWN", () => {
    const s = summary([remoteReport("UNKNOWN", [REMOTE_UNVERIFIED_REASON])])
    const out = refineSummaryWithEvidence(s, new Map([["https://other.example", cleanBundle]]))
    expect(out.reports[0]!.verdict).toBe("UNKNOWN")
  })

  it("ignores a non-remote-endpoint bundle (subjectType guard)", () => {
    const npmish: EvidenceBundle = { ...cleanBundle, subject: { ...cleanBundle.subject, subjectType: "npm-package" } }
    const s = summary([remoteReport("UNKNOWN", [REMOTE_UNVERIFIED_REASON])])
    const out = refineSummaryWithEvidence(s, new Map([[URL, npmish]]))
    expect(out.reports[0]!.verdict).toBe("UNKNOWN")
  })
})
