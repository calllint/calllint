import { describe, it, expect } from "vitest"
import type { AuthorityCapability, AuthorityManifest } from "@calllint/types"
import { hashJson } from "@calllint/fingerprint"
import { decideOverAuthority, defaultPolicy } from "@calllint/policy"
import { buildFlows, foldFlowsIntoReasons } from "@calllint/flow-analyzer"

/**
 * THE ADR 0040 §4 RELEASE GATE, as an exhaustive integration invariant: a dangerous flow
 * never resolves to SAFE. For every multi-tool snapshot below that contains an
 * untrusted/sensitive source reaching an egress sink, we build the flows, fold them into
 * the decision (foldFlowsIntoReasons), run the deterministic policy (decideOverAuthority),
 * and assert the verdict is NOT SAFE — the composition raised it. Benign controls
 * (all-trusted / no-egress) assert the converse: an ALLOW/absent flow never fabricates a
 * dangerous verdict from the flow layer.
 *
 * This lives in tests/invariants (not a single package) because it spans the whole
 * flow→decision path across @calllint/flow-analyzer + @calllint/policy — the exact
 * property Phase F promised, mirroring the corpus "dangerous input never SAFE" rule.
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

const secretRead = cap({ action: "read", resource: "secret", scope: "API_KEY", evidenceSource: "server.env.API_KEY", trustSource: "sensitive.secret" })
const privateRead = cap({ action: "read", resource: "filesystem", scope: "~/data", evidenceSource: "SKILL.md:4", trustSource: "sensitive.private_data" })
const publicRead = cap({ action: "read", resource: "network", scope: "issue", evidenceSource: "SKILL.md:2", trustSource: "untrusted.public_content" })
const toolOutRead = cap({ action: "read", resource: "message", evidenceSource: "SKILL.md:9", trustSource: "untrusted.tool_output" })
const trustedRead = cap({ action: "read", resource: "filesystem", scope: "project", evidenceSource: "server.command", trustSource: "trusted.user_explicit" })

const netPinned = cap({ action: "send", resource: "network", destination: "attacker.example.com", evidenceSource: "SKILL.md:12", pattern: "data-exfil" })
const netUnpinned = cap({ action: "send", resource: "network", destination: null, evidenceSource: "SKILL.md:13", pattern: "data-exfil" })
const connectNet = cap({ action: "connect", resource: "network", destination: "api.example.com", scope: "api.example.com", evidenceSource: "server.url" })
const msgSend = cap({ action: "send", resource: "message", evidenceSource: "SKILL.md:20", pattern: "messaging-financial" })
const spend = cap({ action: "spend", resource: "financial", evidenceSource: "SKILL.md:30", pattern: "messaging-financial" })

/** ≥10 multi-tool flow snapshots. Each `dangerous` case MUST NOT resolve to SAFE. */
const SNAPSHOTS: Array<{ id: string; manifests: AuthorityManifest[]; dangerous: boolean }> = [
  { id: "F-SNAP-01 secret→pinned-net (exfil)", manifests: [manifest([secretRead, netPinned])], dangerous: true },
  { id: "F-SNAP-02 secret→financial spend", manifests: [manifest([secretRead, spend])], dangerous: true },
  { id: "F-SNAP-03 secret→unpinned-net", manifests: [manifest([secretRead, netUnpinned])], dangerous: true },
  { id: "F-SNAP-04 secret→messaging", manifests: [manifest([secretRead, msgSend])], dangerous: true },
  { id: "F-SNAP-05 private-data→connect-net", manifests: [manifest([privateRead, connectNet])], dangerous: true },
  { id: "F-SNAP-06 public-content→pinned-net", manifests: [manifest([publicRead, netPinned])], dangerous: true },
  { id: "F-SNAP-07 tool-output→messaging", manifests: [manifest([toolOutRead, msgSend])], dangerous: true },
  { id: "F-SNAP-08 cross-manifest secret→net", manifests: [manifest([secretRead]), manifest([netPinned])], dangerous: true },
  { id: "F-SNAP-09 cross-manifest public→spend", manifests: [manifest([publicRead]), manifest([spend])], dangerous: true },
  { id: "F-SNAP-10 secret + two sinks", manifests: [manifest([secretRead, netPinned, msgSend])], dangerous: true },
  { id: "F-SNAP-11 trusted→net (ALLOW)", manifests: [manifest([trustedRead, netPinned])], dangerous: false },
  { id: "F-SNAP-12 secret, no egress sink", manifests: [manifest([secretRead])], dangerous: false },
]

describe("ADR 0040 §4 gate — dangerous flow never resolves to SAFE (fold→decide, end to end)", () => {
  for (const snap of SNAPSHOTS) {
    it(snap.id, () => {
      // buildFlows enumerates compositions WITHIN and ACROSS the given manifests, so the
      // whole snapshot is analyzed together (a cross-manifest source→sink is the point).
      const flowReasons = foldFlowsIntoReasons(buildFlows(snap.manifests))

      const decision = decideOverAuthority({
        authority: snap.manifests[0]!,
        policy: defaultPolicy(),
        flowReasons,
      })

      if (snap.dangerous) {
        expect(flowReasons.some((r) => r.code === "TOXIC_FLOW_COMPOSITION")).toBe(true)
        expect(decision.verdict).not.toBe("SAFE")
      } else {
        expect(flowReasons.some((r) => r.code === "TOXIC_FLOW_COMPOSITION")).toBe(false)
      }
    })
  }

  it("has at least 10 dangerous multi-tool flow snapshots (ADR 0040 §4)", () => {
    expect(SNAPSHOTS.filter((s) => s.dangerous).length).toBeGreaterThanOrEqual(10)
  })
})
