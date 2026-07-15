/**
 * calllint.flow.v0 — Static Toxic-Flow object (object of Phase F, sibling to the
 * six Trust-Gateway objects).
 *
 * A per-tool scan evaluates each tool in isolation, but the real danger is a
 * **composition across tools**:
 *
 *   untrusted public content → read a private/secret resource → send it to an external sink
 *
 * Each step alone may be REVIEW-or-lower; the *path* is the blocker. A Flow expresses
 * exactly one such path over the sealed Authority Manifest(s) (`calllint.authority.v0`):
 * a trust-classified `source`, ordered `steps`, and a terminal `sink`. It is **not a
 * second verdict** — its `decisionHint` is folded into `calllint.decision.v0` as
 * `reasons`; the scan/gateway verdict stays `SAFE/REVIEW/BLOCK/UNKNOWN` (ADR 0040 §1).
 *
 * PURE & DETERMINISTIC: built from sealed manifests with no clock, no I/O, no LLM. Same
 * input manifests → byte-identical flows (digest stable). The target is never executed
 * (I-06 extends to Flow). `steps[]`/`sink` use the shipped closed `action` (9) × `resource`
 * (10) vocabulary ONLY — no forked flow vocabulary (ADR 0040 §2). See ADR 0040 / 0041 and
 * schemas/flow.schema.json.
 */
import type { AuthorityAction, AuthorityResource, TrustSource } from "./authority.js"

/**
 * A flow's own recommendation. NOT a verdict enum: it is a HINT folded into the
 * decision's `reasons`. `ALLOW` means the composition is benign (e.g. a read-only path,
 * or a trusted source), `REVIEW` warrants human confirmation, `BLOCK` is a dangerous
 * composition (untrusted/sensitive source reaching an external sink). See ADR 0040 §1.
 */
export const FLOW_DECISION_HINTS = ["ALLOW", "REVIEW", "BLOCK"] as const
export type FlowDecisionHint = (typeof FLOW_DECISION_HINTS)[number]

/** How severe the composition is. Coarse, deterministic; mirrors risk-class granularity. */
export const FLOW_RISK_CLASSES = ["none", "low", "medium", "high", "critical"] as const
export type FlowRiskClass = (typeof FLOW_RISK_CLASSES)[number]

/**
 * The trust-classified head of a flow: the DATA source (ADR 0041 `trustSource`) plus the
 * exact evidence bytes that grounded the classification. `trustSource` may be `unknown`
 * (fail-safe) — an `unknown` source never reads as trusted (I-04), so a rule that needs a
 * *trusted* source cannot fire on `unknown`, and a rule that fires on an *untrusted/sensitive*
 * source only does so when the class is established.
 */
export interface FlowSource {
  trustSource: TrustSource
  /** Exact provenance bytes that grounded the source classification. Never empty. */
  evidence: string[]
}

/**
 * One intermediate step of the path (e.g. `read × secret`). Uses the shipped closed
 * authority vocabulary only (ADR 0040 §2). `scope` is where the authority applies (a
 * path, host, or scope string); null when unbounded/unknown.
 */
export interface FlowStep {
  action: AuthorityAction
  resource: AuthorityResource
  scope: string | null
}

/**
 * The terminal sink of the path — where data would leave (e.g. `send × network` to an
 * external host). Shipped vocabulary only. `destination` is the outbound host/URL when
 * known; null otherwise.
 */
export interface FlowSink {
  action: AuthorityAction
  resource: AuthorityResource
  /** Outbound destination (host/URL) for send/connect sinks; null when unknown/unbounded. */
  destination: string | null
}

/** The composition's risk, as a coarse class + a normalized severity. */
export interface FlowRisk {
  class: FlowRiskClass
  /** 0..100 normalized severity; deterministic function of (class, hint). */
  severity: number
}

/**
 * One static toxic-flow path. `flowId` is a stable, human-legible id for the path shape
 * (e.g. `flow:public-read-to-external-send`); it is NOT unique per instance — the same
 * path shape across artifacts shares the id, and the `digest` seals the concrete instance.
 * `authorityDigests` binds the exact manifest(s) analyzed so a flow is always traceable to
 * the inventory it was derived from.
 */
export interface Flow {
  schema: "calllint.flow.v0"
  /** Stable id for the path shape, e.g. "flow:public-read-to-external-send". */
  flowId: string
  /** The trust-classified data source at the head of the path. */
  source: FlowSource
  /** Ordered intermediate steps (shipped authority vocabulary only). May be empty. */
  steps: FlowStep[]
  /** The terminal sink where data would leave. */
  sink: FlowSink
  risk: FlowRisk
  /** A HINT folded into the decision's `reasons` — never a second verdict (ADR 0040 §1). */
  decisionHint: FlowDecisionHint
  /** Exact bytes grounding the flow. Mandatory — a flow is never unsourced (I-07). */
  evidence: string[]
  /** Digests of the Authority Manifest(s) analyzed to produce this flow (sorted, deduped). */
  authorityDigests: string[]
  /** sha256 over this object minus its own `digest` field (hashJson). */
  digest: `sha256:${string}`
}

export const FLOW_SCHEMA_VERSION = "calllint.flow.v0" as const
