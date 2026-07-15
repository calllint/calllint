import { describe, it, expect } from "vitest"
import type { AuthorityCapability, AuthorityManifest } from "@calllint/types"
import { hashJson } from "@calllint/fingerprint"
import { buildFlows, verifyFlowDigest } from "../src/index.js"

/**
 * Locks the F2 flow constructor (ADR 0040). buildFlows enumerates cross-capability
 * compositions (a trust-classified source reaching an egress sink) over sealed
 * Authority Manifests, purely and deterministically, and seals each flow with a
 * digest. It is the MECHANISM + a fail-safe baseline (never ALLOW/SAFE, I-04 & §4);
 * the named BLOCK/ALLOW rule catalog with paired fixtures is Phase F3.
 */

function cap(partial: Partial<AuthorityCapability>): AuthorityCapability {
  return {
    action: "read",
    resource: "filesystem",
    scope: null,
    destination: null,
    mutability: "read-only",
    reversibility: "n/a",
    monetaryLimit: null,
    approvalRequirement: "none",
    evidenceSource: "<test>",
    confidence: "high",
    completeness: "complete",
    ...partial,
  }
}

/** Seal a manifest exactly like buildAuthorityManifest (digest over object minus digest). */
function manifest(capabilities: AuthorityCapability[]): AuthorityManifest {
  const sealed: Omit<AuthorityManifest, "digest"> = {
    schema: "calllint.authority.v0",
    subject: { artifactDigest: `sha256:${"a".repeat(64)}` },
    capabilities,
    limits: { spendPerCall: null, spendTotal: null },
    approval: { required: [] },
    unknowns: [],
    completeness: "complete",
  }
  return { ...sealed, digest: hashJson(sealed) as `sha256:${string}` }
}

const secretSource = cap({
  action: "read",
  resource: "secret",
  scope: "OPENAI_API_KEY",
  evidenceSource: "server.env.OPENAI_API_KEY",
  trustSource: "sensitive.secret",
})

const networkSink = cap({
  action: "send",
  resource: "network",
  destination: "evil.example.com",
  evidenceSource: "SKILL.md:12",
  pattern: "data-exfil",
})

describe("buildFlows — mechanism: source × sink composition", () => {
  it("a sensitive source + an egress sink in one manifest produces one flow", () => {
    const flows = buildFlows([manifest([secretSource, networkSink])])
    expect(flows).toHaveLength(1)
    const f = flows[0]!
    expect(f.schema).toBe("calllint.flow.v0")
    expect(f.source.trustSource).toBe("sensitive.secret")
    expect(f.sink).toMatchObject({ action: "send", resource: "network" })
    expect(f.flowId).toBe("flow:sensitive-to-send-network")
  })

  it("composes ACROSS manifests — a source in one, a sink in another", () => {
    const flows = buildFlows([manifest([secretSource]), manifest([networkSink])])
    expect(flows).toHaveLength(1)
    // Binds BOTH manifests it was derived from.
    expect(flows[0]!.authorityDigests).toHaveLength(2)
  })

  it("every flow carries mandatory evidence and a bound authority digest (I-07)", () => {
    const [f] = buildFlows([manifest([secretSource, networkSink])])
    expect(f!.evidence.length).toBeGreaterThan(0)
    expect(f!.source.evidence).toEqual(["server.env.OPENAI_API_KEY"])
    expect(f!.authorityDigests.every((d) => /^sha256:[0-9a-f]{64}$/.test(d))).toBe(true)
  })
})

describe("buildFlows — fail-safe: unknown/trusted sources never seed a flow (I-04)", () => {
  it("a source with no trustSource (unknown) yields no flow", () => {
    const unknownRead = cap({ action: "read", resource: "secret", evidenceSource: "x" }) // no trustSource
    const flows = buildFlows([manifest([unknownRead, networkSink])])
    expect(flows).toHaveLength(0)
  })

  it("a trusted.local_project source yields no flow", () => {
    const trustedExec = cap({
      action: "execute",
      resource: "process",
      evidenceSource: "server.command",
      trustSource: "trusted.local_project",
    })
    const flows = buildFlows([manifest([trustedExec, networkSink])])
    expect(flows).toHaveLength(0)
  })

  it("a sensitive source with NO egress sink yields no flow", () => {
    const flows = buildFlows([manifest([secretSource])])
    expect(flows).toHaveLength(0)
  })
})

describe("buildFlows — dangerous composition never resolves to ALLOW (§4)", () => {
  it("a sensitive secret → external network (pinned host) is BLOCK, never ALLOW", () => {
    const flows = buildFlows([manifest([secretSource, networkSink])])
    expect(flows).toHaveLength(1)
    // networkSink has destination "evil.example.com" → CL-FLOW-001.
    expect(flows[0]!.decisionHint).toBe("BLOCK")
    expect(flows[0]!.risk.class).toBe("critical")
  })
})

describe("buildFlows — determinism & sealing", () => {
  it("same manifests in → byte-identical flows out, independent of manifest list order", () => {
    // Fixed manifest objects (same digests); only the LIST order differs. buildFlows
    // re-sorts internally by capKey, so enumeration is order-independent.
    const mSrc = manifest([secretSource])
    const mSink = manifest([networkSink])
    const a = buildFlows([mSrc, mSink])
    const b = buildFlows([mSink, mSrc])
    expect(hashJson(a)).toBe(hashJson(b))
  })

  it("every flow's digest verifies (seal intact)", () => {
    const flows = buildFlows([manifest([secretSource, networkSink])])
    expect(flows.every(verifyFlowDigest)).toBe(true)
  })

  it("identical composition shapes dedupe by digest", () => {
    // Two egress sinks of the SAME shape (same action/resource/destination/evidence)
    // cannot both survive — but two DIFFERENT sinks yield two flows.
    const msgSink = cap({
      action: "send",
      resource: "message",
      evidenceSource: "SKILL.md:20",
      pattern: "messaging-financial",
    })
    const flows = buildFlows([manifest([secretSource, networkSink, msgSink])])
    expect(flows).toHaveLength(2)
    expect(new Set(flows.map((f) => f.digest)).size).toBe(2)
  })

  it("empty manifests → no flows", () => {
    expect(buildFlows([])).toEqual([])
    expect(buildFlows([manifest([])])).toEqual([])
  })
})
