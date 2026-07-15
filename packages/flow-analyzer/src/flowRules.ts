import type {
  AuthorityCapability,
  FlowDecisionHint,
  FlowRiskClass,
  TrustSource,
} from "@calllint/types"

/**
 * CL-FLOW rule catalog (F3) — the named, deterministic classification of a
 * (source, sink) composition into a `decisionHint` + `risk` (ADR 0040).
 *
 * A per-tool scan cannot see a composition; these rules can. Each is a pure predicate
 * over the two capabilities' already-captured, already-classified fields — `trustSource`
 * (ADR 0041), `action`, `resource`, `destination`. No clock, no I/O, no LLM: same pair in
 * → byte-identical `{ decisionHint, risk }` out.
 *
 * DISCIPLINE (CallLint contract): every rule that can produce a BLOCK or an ALLOW ships a
 * paired positive AND negative fixture + a unit test — see flowRules.test.ts. The order of
 * the table is the precedence: the FIRST matching rule wins, so the most specific /
 * most-severe shapes are listed first and a catch-all fail-safe closes the table.
 *
 * FAIL-SAFE FLOOR (I-04, and the ADR 0040 §4 dangerous-flow-never-SAFE gate): the table is
 * total — every composition matches at least the closing rule — and no dangerous
 * composition can fall through to ALLOW. Anything a specific rule does not claim ALLOW for
 * lands on the REVIEW catch-all, never SAFE.
 */

/** Trust classes whose DATA is untrusted or sensitive — a toxic-flow head. */
const UNTRUSTED_OR_SENSITIVE: ReadonlySet<TrustSource> = new Set<TrustSource>([
  "sensitive.secret",
  "sensitive.private_data",
  "untrusted.public_content",
  "untrusted.tool_output",
  "untrusted.peer_agent",
  "untrusted.memory",
])

/** Trust classes established as trusted — a benign head (ADR 0041 §2 distinction). */
const TRUSTED: ReadonlySet<TrustSource> = new Set<TrustSource>([
  "trusted.policy",
  "trusted.user_explicit",
  "trusted.local_project",
  "trusted.signed_component",
])

function isUntrustedOrSensitive(ts: TrustSource | undefined): boolean {
  return ts !== undefined && UNTRUSTED_OR_SENSITIVE.has(ts)
}
function isTrusted(ts: TrustSource | undefined): boolean {
  return ts !== undefined && TRUSTED.has(ts)
}

/** Sink families, by `(action:resource)`, over the shipped authority vocabulary. */
function sinkKind(sink: AuthorityCapability): "network" | "message" | "financial" | "other" {
  const key = `${sink.action}:${sink.resource}`
  if (key === "send:network" || key === "connect:network") return "network"
  if (key === "send:message") return "message"
  if (key === "spend:financial") return "financial"
  return "other"
}

/** A sink whose destination is an explicit external host (not null/unbounded). */
function hasExternalDestination(sink: AuthorityCapability): boolean {
  return typeof sink.destination === "string" && sink.destination.length > 0
}

/** The outcome a matched rule assigns. `severity` is derived from `class` centrally. */
export interface FlowRuleOutcome {
  ruleId: string
  decisionHint: FlowDecisionHint
  riskClass: FlowRiskClass
}

interface FlowRule {
  id: string
  /** Fires when this predicate holds for the (source, sink) pair. */
  when: (source: AuthorityCapability, sink: AuthorityCapability) => boolean
  decisionHint: FlowDecisionHint
  riskClass: FlowRiskClass
}

/**
 * The ordered rule table. FIRST match wins. Most-severe / most-specific first; a REVIEW
 * catch-all closes it so the classification is total and never falls through to ALLOW.
 */
const FLOW_RULES: readonly FlowRule[] = [
  // CL-FLOW-001 — the canonical toxic flow: untrusted/sensitive data → external network
  // egress with a concrete outbound destination. The motivating incident (new9): a
  // secret / injected public content leaving to an attacker-controlled host.
  {
    id: "CL-FLOW-001",
    when: (s, k) =>
      isUntrustedOrSensitive(s.trustSource) &&
      sinkKind(k) === "network" &&
      hasExternalDestination(k),
    decisionHint: "BLOCK",
    riskClass: "critical",
  },

  // CL-FLOW-002 — untrusted/sensitive data → financial action (spend). Money leaving is
  // irreversible; a tainted source driving it is a blocker regardless of destination.
  {
    id: "CL-FLOW-002",
    when: (s, k) => isUntrustedOrSensitive(s.trustSource) && sinkKind(k) === "financial",
    decisionHint: "BLOCK",
    riskClass: "critical",
  },

  // CL-FLOW-003 — untrusted/sensitive data → external network egress WITHOUT a pinned
  // destination (host unknown). Still dangerous, but the sink is less determined, so it
  // warrants human review rather than an outright block.
  {
    id: "CL-FLOW-003",
    when: (s, k) =>
      isUntrustedOrSensitive(s.trustSource) &&
      sinkKind(k) === "network" &&
      !hasExternalDestination(k),
    decisionHint: "REVIEW",
    riskClass: "high",
  },

  // CL-FLOW-004 — untrusted/sensitive data → outbound messaging (email/chat). Exfiltration
  // via a messaging channel; review-worthy.
  {
    id: "CL-FLOW-004",
    when: (s, k) => isUntrustedOrSensitive(s.trustSource) && sinkKind(k) === "message",
    decisionHint: "REVIEW",
    riskClass: "high",
  },

  // CL-FLOW-ALLOW-001 — an established TRUSTED source reaching an egress sink is the
  // benign counterpart (ADR 0041 §2: trusted.user_explicit → send is routine). Only fires
  // when the source is positively trusted — never on unknown (I-04).
  {
    id: "CL-FLOW-ALLOW-001",
    when: (s, k) => isTrusted(s.trustSource) && sinkKind(k) !== "other",
    decisionHint: "ALLOW",
    riskClass: "none",
  },

  // CL-FLOW-REVIEW-000 — fail-safe catch-all. Any composition not positively classified
  // above (including one whose source trust could not be established) is REVIEW, never
  // ALLOW/SAFE. This keeps the classifier total and dangerous-flow-never-SAFE.
  {
    id: "CL-FLOW-REVIEW-000",
    when: () => true,
    decisionHint: "REVIEW",
    riskClass: "medium",
  },
]

/**
 * Classify a (source, sink) composition against the ordered rule table. Total: always
 * returns the first matching rule's outcome (the catch-all guarantees a match).
 */
export function classifyFlow(
  source: AuthorityCapability,
  sink: AuthorityCapability,
): FlowRuleOutcome {
  for (const rule of FLOW_RULES) {
    if (rule.when(source, sink)) {
      return { ruleId: rule.id, decisionHint: rule.decisionHint, riskClass: rule.riskClass }
    }
  }
  // Unreachable (catch-all matches), but keep the function total for the type-checker.
  return { ruleId: "CL-FLOW-REVIEW-000", decisionHint: "REVIEW", riskClass: "medium" }
}
