import { describe, it, expect } from "vitest"
import { decideOverAuthority, verifyDecisionDigest, defaultPolicy } from "../src/index.js"
import type {
  AuthorityCapability,
  AuthorityManifest,
  GatewayEvidence,
} from "@calllint/types"

/**
 * Locks the G4 deterministic decision (ADR 0035 / 0036):
 *  - verdict = most-severe capability contribution + completeness gaps
 *  - Evidence ≠ Decision: degraded/failed evidence can never yield SAFE
 *  - fail-closed: unpinned artifact / partial manifest → UNKNOWN (outranks REVIEW)
 *  - digest is verifiable and deterministic (same inputs → byte-identical)
 */

const D = ("sha256:" + "a".repeat(64)) as `sha256:${string}`

function cap(over: Partial<AuthorityCapability>): AuthorityCapability {
  return {
    action: "connect",
    resource: "network",
    scope: null,
    destination: null,
    mutability: "read-only",
    reversibility: "n/a",
    monetaryLimit: null,
    approvalRequirement: "review",
    evidenceSource: "server.url",
    confidence: "high",
    completeness: "complete",
    ...over,
  }
}

function manifest(over: Partial<AuthorityManifest> = {}): AuthorityManifest {
  const base: Omit<AuthorityManifest, "digest"> = {
    schema: "calllint.authority.v0",
    subject: { artifactDigest: D },
    capabilities: [],
    limits: { spendPerCall: null, spendTotal: null },
    approval: { required: [] },
    unknowns: [],
    completeness: "complete",
    ...over,
  }
  return { ...base, digest: D }
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

/** All-allow policy: isolates the manifest's own approval requirement (no tightening). */
const lenient = {
  ...policy,
  defaults: {
    unknownSource: "allow",
    unpinnedPackage: "allow",
    broadFilesystemAccess: "allow",
    arbitraryCommandExecution: "allow",
    promptPoisoning: "allow",
    externalMutation: "allow",
    financialAction: "allow",
  },
} as typeof policy

describe("decideOverAuthority — verdict from authority (isolated via lenient policy)", () => {
  it("empty manifest, complete → SAFE with no reasons", () => {
    const d = decideOverAuthority({ authority: manifest(), policy: lenient })
    expect(d.verdict).toBe("SAFE")
    expect(d.reasons).toHaveLength(0)
    expect(d.completeness).toBe("complete")
    expect(d.schema).toBe("calllint.decision.v0")
  })

  it("a block capability → BLOCK", () => {
    const d = decideOverAuthority({
      authority: manifest({
        capabilities: [cap({ approvalRequirement: "block", pattern: "privilege-escalation", resource: "process", action: "execute", evidenceSource: "SKILL.md:2" })],
        approval: { required: ["privilege-escalation"] },
      }),
      policy: lenient,
    })
    expect(d.verdict).toBe("BLOCK")
    expect(d.reasons[0]?.code).toBe("SHELL_OR_DOCKER_EXECUTION")
    expect(d.reasons[0]?.evidenceSource).toBe("SKILL.md:2")
    expect(d.requiredApprovals).toContain("privilege-escalation")
  })

  it("only review capabilities → REVIEW", () => {
    const d = decideOverAuthority({
      authority: manifest({ capabilities: [cap({ approvalRequirement: "review" })] }),
      policy: lenient,
    })
    expect(d.verdict).toBe("REVIEW")
  })
})

describe("decideOverAuthority — policy only TIGHTENS", () => {
  it("a 'deny' default escalates a review-only capability to BLOCK", () => {
    // Under the strict default policy, unknownSource=deny → a network-egress
    // capability the manifest only rated 'review' is escalated to BLOCK.
    const authority = manifest({ capabilities: [cap({ approvalRequirement: "review" })] })
    expect(decideOverAuthority({ authority, policy: lenient }).verdict).toBe("REVIEW")
    expect(decideOverAuthority({ authority, policy }).verdict).toBe("BLOCK")
  })

  it("an 'allow' default never loosens a block capability below its own requirement", () => {
    const d = decideOverAuthority({
      authority: manifest({ capabilities: [cap({ approvalRequirement: "block" })] }),
      policy: lenient,
    })
    expect(d.verdict).toBe("BLOCK")
  })
})

describe("decideOverAuthority — fail-closed completeness", () => {
  it("unpinned artifact (null digest) → UNKNOWN, never SAFE", () => {
    const d = decideOverAuthority({
      authority: manifest({ subject: { artifactDigest: null }, completeness: "partial" }),
      policy,
    })
    expect(d.verdict).toBe("UNKNOWN")
    expect(d.artifactDigest).toBeNull()
    expect(d.unknowns.some((u) => u.includes("unpinned"))).toBe(true)
  })

  it("partial manifest → UNKNOWN outranks a lone REVIEW capability", () => {
    const d = decideOverAuthority({
      authority: manifest({ capabilities: [cap({ approvalRequirement: "review" })], completeness: "partial", unknowns: ["surface truncated"] }),
      policy: lenient,
    })
    expect(d.verdict).toBe("UNKNOWN")
    expect(d.completeness).toBe("partial")
  })
})

describe("decideOverAuthority — Evidence ≠ Decision", () => {
  it("degraded evidence over a clean manifest → UNKNOWN, never SAFE", () => {
    const d = decideOverAuthority({
      authority: manifest(),
      evidence: [evidence({ completeness: "degraded", degradedReasons: ["timeout"] })],
      policy,
    })
    expect(d.verdict).toBe("UNKNOWN")
    expect(d.evidenceDigests).toHaveLength(1)
  })

  it("complete evidence never upgrades a BLOCK to SAFE", () => {
    const d = decideOverAuthority({
      authority: manifest({ capabilities: [cap({ approvalRequirement: "block" })] }),
      evidence: [evidence({ completeness: "complete" })],
      policy,
    })
    expect(d.verdict).toBe("BLOCK")
  })

  it("partial evidence contributes REVIEW but not SAFE", () => {
    const d = decideOverAuthority({
      authority: manifest(),
      evidence: [evidence({ completeness: "partial" })],
      policy,
    })
    expect(d.verdict).toBe("REVIEW")
  })
})

describe("decideOverAuthority — determinism & digest", () => {
  it("same inputs → byte-identical decision (digest included)", () => {
    const m = manifest({ capabilities: [cap({}), cap({ resource: "secret", action: "read", evidenceSource: "server.env.TOKEN" })] })
    const a = decideOverAuthority({ authority: m, policy })
    const b = decideOverAuthority({ authority: m, policy })
    expect(a).toEqual(b)
    expect(a.digest).toBe(b.digest)
  })

  it("digest verifies and reasons are frozen-code, deterministically ordered", () => {
    const d = decideOverAuthority({
      authority: manifest({
        capabilities: [
          cap({ resource: "network", action: "connect", evidenceSource: "z" }),
          cap({ resource: "secret", action: "read", evidenceSource: "a" }),
        ],
      }),
      policy,
    })
    expect(verifyDecisionDigest(d)).toBe(true)
    // SECRET_IN_WORKSPACE_CONFIG (#3) sorts before UNKNOWN_REMOTE (#2)? order = frozen index.
    const codes = d.reasons.map((r) => r.code)
    expect(codes).toEqual([...codes].sort((x, y) => codes.indexOf(x) - codes.indexOf(y)))
  })

  it("tamper flips verifyDecisionDigest to false", () => {
    const d = decideOverAuthority({ authority: manifest({ capabilities: [cap({})] }), policy })
    expect(verifyDecisionDigest({ ...d, verdict: "SAFE" })).toBe(false)
  })
})
