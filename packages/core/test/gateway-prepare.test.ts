import { describe, it, expect } from "vitest"
import { prepare, prepareExitCode } from "../src/index.js"
import type { ArtifactIdentity, GatewayEvidence } from "@calllint/types"

/**
 * Locks the ADR 0035 read-only preparation invariants (pure core):
 *  - a resolved artifact reaches PLAN_READY (exit 0)
 *  - a partial artifact stops at FETCH_REJECTED (exit 10) — not a pass
 *  - an unresolved artifact stops at RESOLUTION_FAILED (exit 20) — never a pass
 *  - downstream slots (evidence/authority/decision/plan) are null in G1
 *  - preparedAt is injected (determinism)
 */

const AT = "2026-07-13T00:00:00.000Z"

function artifact(partial: Partial<ArtifactIdentity>): ArtifactIdentity {
  return {
    schema: "calllint.artifact.v1",
    sourceType: "dir",
    source: "./skill",
    requestedRef: null,
    resolvedRef: "content:sha256:" + "a".repeat(64),
    digest: ("sha256:" + "a".repeat(64)) as `sha256:${string}`,
    resolvedAt: AT,
    resolution: "resolved",
    ...partial,
  }
}

describe("gateway prepare (G1, read-only)", () => {
  it("resolved artifact → PLAN_READY, empty downstream slots, exit 0", () => {
    const p = prepare({ artifact: artifact({}), preparedAt: AT })
    expect(p.schema).toBe("calllint.trust-preparation.v0")
    expect(p.state).toBe("PLAN_READY")
    expect(p.evidence).toBeNull()
    expect(p.authority).toBeNull()
    expect(p.decision).toBeNull()
    expect(p.plan).toBeNull()
    expect(p.preparedAt).toBe(AT)
    expect(prepareExitCode(p)).toBe(0)
  })

  it("partial artifact → FETCH_REJECTED (exit 10), never a pass", () => {
    const p = prepare({
      artifact: artifact({ resolution: "partial", digest: null, resolvedRef: "1.3.0" }),
      preparedAt: AT,
    })
    expect(p.state).toBe("FETCH_REJECTED")
    expect(prepareExitCode(p)).toBe(10)
    expect(p.notes.some((n) => /not a verified target/.test(n))).toBe(true)
  })

  it("unresolved artifact → RESOLUTION_FAILED (exit 20), never a pass", () => {
    const p = prepare({
      artifact: artifact({
        resolution: "unresolved",
        digest: null,
        resolvedRef: null,
        resolutionReasons: ["offline"],
      }),
      preparedAt: AT,
    })
    expect(p.state).toBe("RESOLUTION_FAILED")
    expect(prepareExitCode(p)).toBe(20)
    expect(p.notes).toContain("offline")
  })

  it("is deterministic — byte-identical for the same artifact", () => {
    const a = artifact({})
    expect(JSON.stringify(prepare({ artifact: a, preparedAt: AT }))).toBe(
      JSON.stringify(prepare({ artifact: a, preparedAt: AT }))
    )
  })
})

/** Minimal evidence envelope for the gateway (calllint.evidence-provider.v0). */
function evidence(completeness: GatewayEvidence["completeness"], reasons: string[] = []): GatewayEvidence {
  return {
    schema_version: "calllint.evidence-provider.v0",
    provider: "skillspector",
    providerVersion: completeness === "complete" ? "git:" + "a".repeat(40) : "unknown",
    completeness,
    scanMode: "static",
    findings: [],
    degradedReasons: reasons,
    rawReportDigest: ("sha256:" + "b".repeat(64)) as `sha256:${string}`,
  }
}

describe("gateway prepare (G2, evidence attach — never re-scored, only tightens)", () => {
  it("resolved + complete evidence → PLAN_READY (exit 0)", () => {
    const p = prepare({ artifact: artifact({}), evidence: [evidence("complete")], preparedAt: AT })
    expect(p.state).toBe("PLAN_READY")
    expect(p.evidence).toHaveLength(1)
    expect(p.evidence![0]!.provider).toBe("skillspector")
    expect(prepareExitCode(p)).toBe(0)
  })

  it("resolved + partial evidence → EVIDENCE_PARTIAL (exit 10)", () => {
    const p = prepare({
      artifact: artifact({}),
      evidence: [evidence("partial", ["provider reported a partial scan"])],
      preparedAt: AT,
    })
    expect(p.state).toBe("EVIDENCE_PARTIAL")
    expect(prepareExitCode(p)).toBe(10)
    expect(p.notes.some((n) => /partial/.test(n))).toBe(true)
  })

  it("resolved + failed evidence → EVIDENCE_FAILED (exit 20), fail-closed", () => {
    const p = prepare({
      artifact: artifact({}),
      evidence: [evidence("failed", ["report is not valid JSON"])],
      preparedAt: AT,
    })
    expect(p.state).toBe("EVIDENCE_FAILED")
    expect(prepareExitCode(p)).toBe(20)
    expect(p.notes.some((n) => /never reads as a pass/.test(n))).toBe(true)
  })

  it("evidence only TIGHTENS — worst completeness across providers wins", () => {
    const p = prepare({
      artifact: artifact({}),
      evidence: [evidence("complete"), evidence("degraded", ["tool crashed"])],
      preparedAt: AT,
    })
    // one complete + one degraded ⇒ fail-closed, never PLAN_READY
    expect(p.state).toBe("EVIDENCE_FAILED")
  })

  it("degraded evidence never RESCUES an unresolved artifact", () => {
    const p = prepare({
      artifact: artifact({ resolution: "unresolved", digest: null, resolvedRef: null }),
      evidence: [evidence("complete")],
      preparedAt: AT,
    })
    // artifact gate fails first — evidence cannot upgrade it
    expect(p.state).toBe("RESOLUTION_FAILED")
    expect(prepareExitCode(p)).toBe(20)
  })

  it("no evidence attached → PLAN_READY with a note; evidence slot null", () => {
    const p = prepare({ artifact: artifact({}), preparedAt: AT })
    expect(p.state).toBe("PLAN_READY")
    expect(p.evidence).toBeNull()
    expect(p.notes.some((n) => /no external evidence/.test(n))).toBe(true)
  })
})
