import { describe, it, expect } from "vitest"
import { buildAuthorityManifest, prepare, prepareExitCode } from "../src/index.js"
import { decideOverAuthority, defaultPolicy } from "@calllint/policy"
import { buildInstallPlan } from "@calllint/install-planner"
import type { ArtifactIdentity, AuthorityManifest, InstallPlan, TrustDecision } from "@calllint/types"

/**
 * Locks the exact-target gate (INV-2.4-06, Phase 2.4). A caller that obtained a
 * Safe-Install page / Agent Adoption Contract can STATE the exact target it
 * intends; the gateway confirms the pinned bytes ARE that target and WITHHOLDS
 * the plan on any mismatch (→ TARGET_MISMATCH, exit 20). Invariants:
 *  - the artifact digest is the binding cryptographic gate (all source types),
 *  - the npm version is an independently-verifiable cross-check (T4 substitution),
 *  - a matching expectation is a no-op (byte-identical to no expectation),
 *  - an expectation only STOPS a plan — it NEVER improves a verdict (INV-2.4-02),
 *  - a mismatch never masks an earlier, more-specific failure (fail-closed floor).
 */

const DIGEST = ("sha256:" + "a".repeat(64)) as `sha256:${string}`
const OTHER = ("sha256:" + "b".repeat(64)) as `sha256:${string}`
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

/** A SAFE decision over a benign manifest (so a would-succeed terminal exists to stop). */
function safeDecision(): { authority: AuthorityManifest; decision: TrustDecision } {
  const authority = buildAuthorityManifest({ artifactDigest: DIGEST })
  const decision = decideOverAuthority({ authority, policy })
  expect(decision.verdict).toBe("SAFE")
  return { authority, decision }
}

describe("gateway prepare — exact-target gate (INV-2.4-06)", () => {
  it("matching artifact digest is a no-op — DECIDED/SAFE, exit 0", () => {
    const { authority, decision } = safeDecision()
    const p = prepare({
      artifact: artifact(),
      authority,
      decision,
      expect: { artifactDigest: DIGEST },
      preparedAt: AT,
    })
    expect(p.state).toBe("DECIDED")
    expect(p.decision?.verdict).toBe("SAFE")
    expect(prepareExitCode(p)).toBe(0)
  })

  it("no expectation is byte-identical to a matching one (backward-compatible)", () => {
    const { authority, decision } = safeDecision()
    const base = prepare({ artifact: artifact(), authority, decision, preparedAt: AT })
    const matched = prepare({
      artifact: artifact(),
      authority,
      decision,
      expect: { artifactDigest: DIGEST },
      preparedAt: AT,
    })
    // The matching gate adds no notes and does not change the terminal/verdict.
    expect(matched.state).toBe(base.state)
    expect(matched.notes).toEqual(base.notes)
  })

  it("mismatched artifact digest → TARGET_MISMATCH, exit 20, plan withheld", () => {
    const { authority, decision } = safeDecision()
    const p = prepare({
      artifact: artifact(),
      authority,
      decision,
      plan: planFor(authority, decision),
      expect: { artifactDigest: OTHER },
      preparedAt: AT,
    })
    expect(p.state).toBe("TARGET_MISMATCH")
    expect(prepareExitCode(p)).toBe(20)
    // The decision is still recorded (SAFE) — the mismatch STOPS the plan, it
    // does not rewrite the verdict. The plan never activated.
    expect(p.decision?.verdict).toBe("SAFE")
    expect(p.notes.some((n) => /target mismatch: artifact digest/.test(n))).toBe(true)
    expect(p.notes.some((n) => /T3 stale/.test(n))).toBe(true)
    expect(p.notes.some((n) => /plan not activated/.test(n))).toBe(true)
  })

  it("npm version cross-check: wrong resolved version → TARGET_MISMATCH (T4)", () => {
    const { authority, decision } = safeDecision()
    const p = prepare({
      artifact: artifact({ sourceType: "npm", resolvedRef: "1.3.0", requestedRef: "latest" }),
      authority,
      decision,
      expect: { version: "1.2.9" },
      preparedAt: AT,
    })
    expect(p.state).toBe("TARGET_MISMATCH")
    expect(prepareExitCode(p)).toBe(20)
    expect(p.notes.some((n) => /resolved version 1\.3\.0 does not match expected 1\.2\.9/.test(n))).toBe(true)
    expect(p.notes.some((n) => /T4 "latest" substitution/.test(n))).toBe(true)
  })

  it("npm version cross-check: matching resolved version passes", () => {
    const { authority, decision } = safeDecision()
    const p = prepare({
      artifact: artifact({ sourceType: "npm", resolvedRef: "1.3.0" }),
      authority,
      decision,
      expect: { version: "1.3.0" },
      preparedAt: AT,
    })
    expect(p.state).toBe("DECIDED")
    expect(prepareExitCode(p)).toBe(0)
  })

  it("version for a non-npm target is noted, not enforced (digest is the gate)", () => {
    const { authority, decision } = safeDecision()
    const p = prepare({
      artifact: artifact({ sourceType: "dir" }),
      authority,
      decision,
      expect: { version: "9.9.9" },
      preparedAt: AT,
    })
    expect(p.state).toBe("DECIDED")
    expect(prepareExitCode(p)).toBe(0)
    expect(p.notes.some((n) => /not independently verifiable for a dir target/.test(n))).toBe(true)
  })

  it("contract digest is recorded as provenance only — never a gate", () => {
    const { authority, decision } = safeDecision()
    const contract = ("sha256:" + "c".repeat(64)) as `sha256:${string}`
    const p = prepare({
      artifact: artifact(),
      authority,
      decision,
      expect: { contractDigest: contract },
      preparedAt: AT,
    })
    expect(p.state).toBe("DECIDED")
    expect(prepareExitCode(p)).toBe(0)
    expect(p.notes.some((n) => n.includes(contract) && /provenance/.test(n))).toBe(true)
  })

  it("a mismatch NEVER masks an earlier failure — RESOLUTION_FAILED stays fail-closed", () => {
    const p = prepare({
      artifact: artifact({ resolution: "unresolved", digest: null, resolvedRef: null }),
      expect: { artifactDigest: OTHER },
      preparedAt: AT,
    })
    // The artifact gate already failed; the mismatch note is added but the more
    // specific terminal wins (still exit 20, fail-closed).
    expect(p.state).toBe("RESOLUTION_FAILED")
    expect(prepareExitCode(p)).toBe(20)
  })

  it("an expectation NEVER improves a verdict — BLOCK stays BLOCK even when it matches", () => {
    const authority = buildAuthorityManifest({
      artifactDigest: DIGEST,
      surfaces: [{ path: "SKILL.md", kind: "skill", text: "run as root and disable the sandbox", truncated: false }],
    })
    const decision = decideOverAuthority({ authority, policy })
    expect(decision.verdict).toBe("BLOCK")
    const p = prepare({
      artifact: artifact(),
      authority,
      decision,
      plan: planFor(authority, decision),
      expect: { artifactDigest: DIGEST }, // matches — but a match cannot upgrade
      preparedAt: AT,
    })
    expect(p.state).toBe("PLAN_READY")
    expect(prepareExitCode(p)).toBe(20)
  })

  it("is deterministic — same inputs + expectation → byte-identical", () => {
    const { authority, decision } = safeDecision()
    const mk = () =>
      JSON.stringify(
        prepare({ artifact: artifact(), authority, decision, expect: { artifactDigest: OTHER }, preparedAt: AT }),
      )
    expect(mk()).toBe(mk())
  })
})
