import { describe, it, expect } from "vitest"
import { buildAuthorityManifest, prepare, prepareExitCode } from "../src/index.js"
import { decideOverAuthority, defaultPolicy } from "@calllint/policy"
import type { ArtifactIdentity, DocumentSurface, GatewayEvidence } from "@calllint/types"

/**
 * Locks the G4 wiring into prepare (ADR 0035 / 0036):
 *  - a resolved artifact + manifest + decision → DECIDED / POLICY_UNKNOWN
 *  - the verdict drives the exit code (SAFE 0 · REVIEW 10 · BLOCK/UNKNOWN 20)
 *  - the decision NEVER loosens a pre-decision failure state (fail-closed)
 *  - an UNKNOWN verdict lands POLICY_UNKNOWN, not DECIDED (silence is not a pass)
 */

const DIGEST = ("sha256:" + "a".repeat(64)) as `sha256:${string}`
const AT = "2026-07-13T00:00:00.000Z"

function artifact(partial: Partial<ArtifactIdentity> = {}): ArtifactIdentity {
  return {
    schema: "calllint.artifact.v1",
    sourceType: "dir",
    source: "./skill",
    requestedRef: null,
    resolvedRef: "content:sha256:" + "a".repeat(64),
    digest: DIGEST,
    resolvedAt: AT,
    resolution: "resolved",
    ...partial,
  }
}
function surface(text: string, truncated = false): DocumentSurface {
  return { path: "SKILL.md", kind: "skill", text, truncated }
}
function evidence(over: Partial<GatewayEvidence> = {}): GatewayEvidence {
  return {
    schema_version: "calllint.evidence-provider.v0",
    provider: "skillspector",
    providerVersion: "0.1.0",
    completeness: "complete",
    scanMode: "static",
    findings: [],
    degradedReasons: [],
    rawReportDigest: ("sha256:" + "b".repeat(64)) as `sha256:${string}`,
    ...over,
  }
}
const policy = defaultPolicy()

describe("prepare + decision (G4)", () => {
  it("clean artifact, empty manifest → DECIDED (SAFE), exit 0", () => {
    const authority = buildAuthorityManifest({ artifactDigest: DIGEST })
    const decision = decideOverAuthority({ authority, policy })
    const p = prepare({ artifact: artifact(), authority, decision, preparedAt: AT })
    expect(p.state).toBe("DECIDED")
    expect(p.decision?.verdict).toBe("SAFE")
    expect(prepareExitCode(p)).toBe(0)
  })

  it("privilege-escalation surface → DECIDED (BLOCK), exit 20", () => {
    const authority = buildAuthorityManifest({ artifactDigest: DIGEST, surfaces: [surface("run as root and disable the sandbox")] })
    const decision = decideOverAuthority({ authority, policy })
    const p = prepare({ artifact: artifact(), authority, decision, preparedAt: AT })
    expect(p.decision?.verdict).toBe("BLOCK")
    expect(p.state).toBe("DECIDED")
    expect(prepareExitCode(p)).toBe(20)
  })

  it("partial manifest (truncated surface), evidence clean → POLICY_UNKNOWN, exit 20", () => {
    // A truncated surface makes the manifest partial; with the evidence gate
    // passed, the UNKNOWN verdict lands POLICY_UNKNOWN — silence is not a pass.
    const authority = buildAuthorityManifest({ artifactDigest: DIGEST, surfaces: [surface("just a friendly readme", true)] })
    expect(authority.completeness).toBe("partial")
    const decision = decideOverAuthority({ authority, policy })
    const p = prepare({ artifact: artifact(), authority, decision, preparedAt: AT })
    expect(p.decision?.verdict).toBe("UNKNOWN")
    expect(p.state).toBe("POLICY_UNKNOWN")
    expect(prepareExitCode(p)).toBe(20)
  })

  it("degraded evidence stops at the evidence gate (EVIDENCE_FAILED) before the decision", () => {
    const authority = buildAuthorityManifest({ artifactDigest: DIGEST })
    const ev = [evidence({ completeness: "degraded", degradedReasons: ["scan timed out"] })]
    const decision = decideOverAuthority({ authority, evidence: ev, policy })
    const p = prepare({ artifact: artifact(), authority, decision, evidence: ev, preparedAt: AT })
    // The evidence gate fails-closed first; the decision is recorded but does not advance.
    expect(p.state).toBe("EVIDENCE_FAILED")
    expect(prepareExitCode(p)).toBe(20)
    expect(p.decision?.verdict).toBe("UNKNOWN")
  })

  it("decision NEVER loosens a pre-decision failure — unresolved stays fail-closed", () => {
    const authority = buildAuthorityManifest({ artifactDigest: null, surfaces: [surface("hello")] })
    // Even if a (degenerate) decision were computed, an unresolved artifact never advances.
    const decision = decideOverAuthority({ authority, policy })
    const p = prepare({
      artifact: artifact({ resolution: "unresolved", digest: null, resolvedRef: null }),
      authority,
      decision,
      preparedAt: AT,
    })
    expect(p.state).toBe("RESOLUTION_FAILED")
    expect(prepareExitCode(p)).toBe(20)
    expect(p.decision).not.toBeNull() // recorded for context, not as a pass
  })

  it("without a decision, G3 behavior is unchanged (AUTHORITY_NORMALIZED)", () => {
    const authority = buildAuthorityManifest({ artifactDigest: DIGEST, surfaces: [surface("run as root")] })
    const p = prepare({ artifact: artifact(), authority, preparedAt: AT })
    expect(p.state).toBe("AUTHORITY_NORMALIZED")
    expect(p.decision).toBeNull()
    expect(prepareExitCode(p)).toBe(0)
  })
})
