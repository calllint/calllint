import type {
  AuthorityCapability,
  AuthorityManifest,
  Flow,
  FlowRisk,
  FlowRiskClass,
  TrustSource,
} from "@calllint/types"
import { FLOW_SCHEMA_VERSION } from "@calllint/types"
import { hashJson } from "@calllint/fingerprint"
import { classifyFlow } from "./flowRules.js"

/**
 * buildFlows (F2/F3) — the static Toxic-Flow constructor for `calllint.flow.v0`.
 *
 * Reads sealed Authority Manifest(s) and enumerates cross-capability *compositions*:
 * a trust-classified data SOURCE (a `read` capability whose `trustSource` is established
 * — untrusted/sensitive OR trusted) that can reach an egress SINK (`send`/`connect ×
 * network|message`, `spend × financial`). Each (source, sink) pair — within OR across
 * manifests (the composition is the point) — becomes one `Flow`.
 *
 * PURE & DETERMINISTIC: no clock, no I/O, no LLM; the target is never executed (I-06).
 * Same input manifests → byte-identical flows (each `digest` sealed via hashJson).
 *
 * The `{ decisionHint, risk }` of each flow comes from the ordered CL-FLOW rule catalog
 * (`flowRules.ts`, Phase F3): untrusted/sensitive → external egress is BLOCK/REVIEW; a
 * positively-TRUSTED source reaching a sink is ALLOW; everything else falls to the REVIEW
 * catch-all. No dangerous composition can resolve to ALLOW/SAFE (I-04, ADR 0040 §4).
 *
 * FAIL-SAFE SOURCE GATE: a source must be a `read` action with an ESTABLISHED trustSource.
 * `unknown` / absent trustSource never seeds a flow (I-04) — a composition whose head we
 * cannot classify is not asserted as either dangerous or benign.
 */

/** Trust classes we can act on as a flow HEAD — untrusted/sensitive OR positively trusted. */
const CLASSIFIED_SOURCE_TRUST: ReadonlySet<TrustSource> = new Set<TrustSource>([
  "sensitive.secret",
  "sensitive.private_data",
  "untrusted.public_content",
  "untrusted.tool_output",
  "untrusted.peer_agent",
  "untrusted.memory",
  "trusted.policy",
  "trusted.user_explicit",
  "trusted.local_project",
  "trusted.signed_component",
])

/**
 * Egress `(action:resource)` pairs — where data LEAVES. Matches the shipped compiler
 * signals: config `connect × network` (server.url), instruction `send × network`
 * (data-exfil), `send × message` (messaging), `spend × financial` (financial).
 */
const EGRESS_SINKS: ReadonlySet<string> = new Set<string>([
  "send:network",
  "send:message",
  "connect:network",
  "spend:financial",
])

/**
 * Is this capability a toxic-flow source head? A source is a `read` action whose
 * `trustSource` is ESTABLISHED (untrusted/sensitive or positively trusted). `unknown` /
 * absent trustSource, and any non-`read` action (e.g. `execute × process`, whose
 * `trusted.local_project` is *execution* trust, not a data read), never qualify —
 * fail-safe: a head we cannot classify is neither asserted dangerous nor benign (I-04).
 */
function isSource(c: AuthorityCapability): boolean {
  return c.action === "read" && c.trustSource !== undefined && CLASSIFIED_SOURCE_TRUST.has(c.trustSource)
}

/** Is this capability an egress sink (data leaves)? */
function isSink(c: AuthorityCapability): boolean {
  return EGRESS_SINKS.has(`${c.action}:${c.resource}`)
}

/** Coarse source family for the `flowId` shape. */
function sourceFamily(ts: TrustSource): string {
  if (ts.startsWith("sensitive.")) return "sensitive"
  if (ts.startsWith("trusted.")) return "trusted"
  return "untrusted"
}

/** Deterministic severity for a risk class (0..100). */
const SEVERITY: Record<FlowRiskClass, number> = {
  none: 0,
  low: 20,
  medium: 50,
  high: 75,
  critical: 95,
}

/** One capability tagged with the digest of the manifest it came from. */
interface TaggedCap {
  cap: AuthorityCapability
  manifestDigest: string
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Stable per-capability sort key so enumeration order is input-order-independent. */
function capKey(t: TaggedCap): string {
  const c = t.cap
  return [
    t.manifestDigest,
    c.trustSource ?? "",
    c.action,
    c.resource,
    c.scope ?? "",
    c.destination ?? "",
    c.evidenceSource,
  ].join("|")
}

/** Seal a flow: digest = sha256 over the object minus its own `digest` (hashJson). */
function sealFlow(flow: Omit<Flow, "digest">): Flow {
  return { ...flow, digest: hashJson(flow) as `sha256:${string}` }
}

/**
 * Build the deterministic set of static toxic-flow paths across the given sealed
 * manifests. Empty when no (source, sink) composition exists. Flows are deduped by
 * digest and returned in a stable order.
 */
export function buildFlows(manifests: readonly AuthorityManifest[]): Flow[] {
  // Flatten every capability across every manifest, tagged with its manifest digest,
  // then sort so enumeration is independent of the manifests' input order.
  const tagged: TaggedCap[] = manifests
    .flatMap((m) => m.capabilities.map((cap) => ({ cap, manifestDigest: m.digest })))
    .sort((a, b) => cmp(capKey(a), capKey(b)))

  const sources = tagged.filter((t) => isSource(t.cap))
  const sinks = tagged.filter((t) => isSink(t.cap))

  const byDigest = new Map<string, Flow>()

  for (const src of sources) {
    for (const snk of sinks) {
      // A capability cannot be both ends of the same path.
      if (src.cap === snk.cap) continue

      const ts = src.cap.trustSource as TrustSource // isSource guarantees defined
      const outcome = classifyFlow(src.cap, snk.cap)
      const risk: FlowRisk = {
        class: outcome.riskClass,
        severity: SEVERITY[outcome.riskClass],
      }

      const sinkTag = `${snk.cap.action}-${snk.cap.resource}`
      const flowId = `flow:${sourceFamily(ts)}-to-${sinkTag}`

      const evidence = [...new Set([src.cap.evidenceSource, snk.cap.evidenceSource])].sort()
      const authorityDigests = [...new Set([src.manifestDigest, snk.manifestDigest])].sort()

      const flow = sealFlow({
        schema: FLOW_SCHEMA_VERSION,
        flowId,
        source: { trustSource: ts, evidence: [src.cap.evidenceSource] },
        steps: [{ action: src.cap.action, resource: src.cap.resource, scope: src.cap.scope }],
        sink: {
          action: snk.cap.action,
          resource: snk.cap.resource,
          destination: snk.cap.destination,
        },
        risk,
        decisionHint: outcome.decisionHint,
        evidence,
        authorityDigests,
      })

      // Identical composition shapes seal to the same digest — dedupe.
      if (!byDigest.has(flow.digest)) byDigest.set(flow.digest, flow)
    }
  }

  // Stable output order: by flowId, then by the sealing digest.
  return [...byDigest.values()].sort(
    (a, b) => cmp(a.flowId, b.flowId) || cmp(a.digest, b.digest),
  )
}

/** Recompute a flow's digest and compare (tamper check for downstream consumers). */
export function verifyFlowDigest(flow: Flow): boolean {
  const { digest, ...rest } = flow
  return digest === hashJson(rest)
}
