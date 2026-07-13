import { describe, it, expect } from "vitest"
import { prepare, prepareExitCode } from "../src/index.js"
import type { ArtifactIdentity } from "@calllint/types"

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
