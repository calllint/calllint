import { describe, it, expect } from "vitest"
import { buildAuthorityManifest, prepare, prepareExitCode } from "../src/index.js"
import { decideOverAuthority, defaultPolicy } from "@calllint/policy"
import { buildInstallPlan } from "@calllint/install-planner"
import type {
  ArtifactIdentity,
  AuthorityManifest,
  DocumentSurface,
  InstallPlan,
  TrustDecision,
} from "@calllint/types"

/**
 * Locks the G5 wiring into prepare (ADR 0036):
 *  - a plan advances DECIDED → PLAN_READY only for a non-blocking verdict
 *  - the verdict still drives the exit code (SAFE 0 · REVIEW 10)
 *  - a plan NEVER activates against a blocking verdict or a failure state
 *  - no host / no plan → behavior is unchanged (stays DECIDED)
 */

const DIGEST = ("sha256:" + "a".repeat(64)) as `sha256:${string}`
const AT = "2026-07-13T00:00:00.000Z"
const policy = defaultPolicy()

function artifact(partial: Partial<ArtifactIdentity> = {}): ArtifactIdentity {
  return {
    schema: "calllint.artifact.v1",
    sourceType: "mcp-config",
    source: "./mcp.json",
    requestedRef: null,
    resolvedRef: "content:sha256:" + "a".repeat(64),
    digest: DIGEST,
    resolvedAt: AT,
    resolution: "resolved",
    ...partial,
  }
}
function surface(text: string): DocumentSurface {
  return { path: "SKILL.md", kind: "skill", text, truncated: false }
}

function planFor(authority: AuthorityManifest, decision: TrustDecision): InstallPlan {
  return buildInstallPlan(
    {
      host: "claude-code",
      tier: "B",
      configPath: "~/.claude.json",
      configDigest: "absent",
      currentConfig: null,
      servers: [{ name: "demo", entry: { command: "node", args: ["s.js"] } }],
      backupPath: "~/.claude.json.calllint-backup",
      expiresAt: "2026-07-13T01:00:00.000Z",
    },
    { artifactDigest: DIGEST, authority, decision },
  )
}

describe("prepare + install plan (G5)", () => {
  it("SAFE decision + plan → PLAN_READY, exit 0, plan bound", () => {
    const authority = buildAuthorityManifest({ artifactDigest: DIGEST })
    const decision = decideOverAuthority({ authority, policy })
    expect(decision.verdict).toBe("SAFE")
    const p = prepare({ artifact: artifact(), authority, decision, plan: planFor(authority, decision), preparedAt: AT })
    expect(p.state).toBe("PLAN_READY")
    expect(p.plan?.host).toBe("claude-code")
    expect(p.plan?.decisionDigest).toBe(decision.digest)
    expect(prepareExitCode(p)).toBe(0)
  })

  it("REVIEW decision + plan → PLAN_READY, exit 10 (verdict still drives the code)", () => {
    // messaging → REVIEW under default policy.
    const authority = buildAuthorityManifest({ artifactDigest: DIGEST, surfaces: [surface("send an email to the user")] })
    const decision = decideOverAuthority({ authority, policy })
    expect(decision.verdict).toBe("REVIEW")
    const p = prepare({ artifact: artifact(), authority, decision, plan: planFor(authority, decision), preparedAt: AT })
    expect(p.state).toBe("PLAN_READY")
    expect(prepareExitCode(p)).toBe(10)
  })

  it("BLOCK decision + plan → PLAN_READY but exit 20 (a BLOCK plan is never a pass)", () => {
    const authority = buildAuthorityManifest({ artifactDigest: DIGEST, surfaces: [surface("run as root and disable the sandbox")] })
    const decision = decideOverAuthority({ authority, policy })
    expect(decision.verdict).toBe("BLOCK")
    // The plan is the exact reversible change; it is computed, but the verdict
    // rides in decisionDigest and drives the code — apply needs a digest-bound
    // approval (G6). PLAN_READY ≠ "safe to apply".
    const p = prepare({ artifact: artifact(), authority, decision, plan: planFor(authority, decision), preparedAt: AT })
    expect(p.state).toBe("PLAN_READY")
    expect(prepareExitCode(p)).toBe(20)
    expect(p.notes.some((n) => n.includes("would require an explicit, digest-bound approval"))).toBe(true)
  })

  it("UNKNOWN decision (partial) → plan NEVER activates (POLICY_UNKNOWN, exit 20)", () => {
    // A truncated surface makes the manifest partial → UNKNOWN → POLICY_UNKNOWN.
    const authority = buildAuthorityManifest({
      artifactDigest: DIGEST,
      surfaces: [{ path: "SKILL.md", kind: "skill", text: "friendly readme", truncated: true }],
    })
    const decision = decideOverAuthority({ authority, policy })
    expect(decision.verdict).toBe("UNKNOWN")
    const p = prepare({ artifact: artifact(), authority, decision, plan: planFor(authority, decision), preparedAt: AT })
    expect(p.state).toBe("POLICY_UNKNOWN")
    expect(p.notes.some((n) => n.includes("plan not activated"))).toBe(true)
    expect(prepareExitCode(p)).toBe(20)
  })

  it("no plan (no host) → unchanged DECIDED behavior", () => {
    const authority = buildAuthorityManifest({ artifactDigest: DIGEST })
    const decision = decideOverAuthority({ authority, policy })
    const p = prepare({ artifact: artifact(), authority, decision, preparedAt: AT })
    expect(p.state).toBe("DECIDED")
    expect(p.plan).toBeNull()
    expect(prepareExitCode(p)).toBe(0)
  })
})
