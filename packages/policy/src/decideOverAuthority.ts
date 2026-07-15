import type {
  AuthorityCapability,
  AuthorityManifest,
  DecisionReason,
  GatewayEvidence,
  Policy,
  PolicyAction,
  ReasonCode,
  TrustDecision,
  Verdict,
} from "@calllint/types"
import {
  DECISION_SCHEMA_VERSION,
  REASON_CODES,
  VERDICT_SEVERITY,
  mostSevereVerdict,
} from "@calllint/types"
import { hashJson } from "@calllint/fingerprint"

/**
 * decideOverAuthority (G4) — the DETERMINISTIC policy decision, object 4.
 *
 * Reads the Authority Manifest (object 3) as a capability inventory and produces
 * a `calllint.decision.v0` verdict under a policy. Pure: no clock, no I/O.
 *
 * Two invariants it exists to enforce:
 *  1. **Evidence ≠ Decision.** External evidence may tighten `completeness` (a
 *     degraded/partial scan can only lower confidence, never raise it) but never
 *     sets the verdict alone — the verdict comes from normalized authority + policy.
 *  2. **Fail-closed.** Silence is never SAFE: an unpinned artifact, a partial
 *     manifest, or degraded evidence forces UNKNOWN, which outranks REVIEW and
 *     never reads as a pass.
 *
 * Verdict = most-severe of every capability's contribution and every completeness
 * gap. Policy only ever TIGHTENS a capability (deny→BLOCK, warn→≥REVIEW); an
 * `allow` default is a no-op and can never loosen a capability below its own
 * approval requirement. See ADR 0035 / 0036.
 */
export interface DecideInput {
  authority: AuthorityManifest
  /** External evidence factored for completeness/provenance only (never re-scored). */
  evidence?: GatewayEvidence[]
  policy: Policy
  /**
   * Static toxic-flow reasons (ADR 0040 §1 / 0044), pre-folded at the edge by
   * `foldFlowsIntoReasons` (@calllint/flow-analyzer). Each is a `TOXIC_FLOW_COMPOSITION`
   * reason carrying a `contributes` verdict (BLOCK/REVIEW). They aggregate under the SAME
   * `mostSevereVerdict` rule as capability reasons — a dangerous flow RAISES the verdict,
   * never lowers it (I-04). Kept as an input (not a dependency) so `@calllint/policy` does
   * not depend on the flow analyzer; the edge owns flow construction.
   */
  flowReasons?: DecisionReason[]
}

/** The frozen reason code a capability projects onto (ADR 0020's 12-code vocab). */
function reasonCodeFor(c: AuthorityCapability): ReasonCode {
  switch (c.pattern) {
    case "privilege-escalation":
    case "auto-exec-bypass":
      return "SHELL_OR_DOCKER_EXECUTION"
    case "sensitive-file-read":
      return "SECRET_IN_WORKSPACE_CONFIG"
    case "data-exfil":
      return "UNKNOWN_REMOTE"
    case "hidden-override":
      return "PROMPT_METADATA_INSTRUCTION"
    case "messaging-financial":
      return c.resource === "financial" ? "MONEY_OR_PAYMENT_CAPABILITY" : "MESSAGING_OR_EMAIL_SEND"
    default:
      break
  }
  // Config-derived capabilities (no instruction pattern): project by action × resource.
  if (c.resource === "financial") return "MONEY_OR_PAYMENT_CAPABILITY"
  if (c.resource === "message") return "MESSAGING_OR_EMAIL_SEND"
  if (c.resource === "secret") return "SECRET_IN_WORKSPACE_CONFIG"
  if (c.resource === "network") return "UNKNOWN_REMOTE"
  if (c.resource === "process") return "SHELL_OR_DOCKER_EXECUTION"
  if (c.resource === "filesystem") return "BROAD_FILESYSTEM_ACCESS"
  return "EXTERNAL_MUTATION_UNKNOWN"
}

/** A capability's own verdict contribution, from its normalized approval requirement. */
function baseVerdict(c: AuthorityCapability): Verdict {
  switch (c.approvalRequirement) {
    case "block":
      return "BLOCK"
    case "review":
      return "REVIEW"
    default:
      return "SAFE"
  }
}

/** How a policy default tightens a reason code. Never loosens (allow = no-op). */
function policyFloor(code: ReasonCode, policy: Policy): Verdict {
  const d = policy.defaults
  const knob: PolicyAction | undefined = {
    UNKNOWN_REMOTE: d.unknownSource,
    UNPINNED_PACKAGE: d.unpinnedPackage,
    BROAD_FILESYSTEM_ACCESS: d.broadFilesystemAccess,
    SHELL_OR_DOCKER_EXECUTION: d.arbitraryCommandExecution,
    PROMPT_METADATA_INSTRUCTION: d.promptPoisoning,
    EXTERNAL_MUTATION_UNKNOWN: d.externalMutation,
    MONEY_OR_PAYMENT_CAPABILITY: d.financialAction,
  }[code as string]
  if (knob === "deny") return "BLOCK"
  if (knob === "warn") return "REVIEW"
  return "SAFE"
}

function moreSevere(a: Verdict, b: Verdict): Verdict {
  return VERDICT_SEVERITY[a] >= VERDICT_SEVERITY[b] ? a : b
}

/** Worst evidence completeness projected to a verdict floor (never SAFE-loosening). */
function evidenceFloor(evidence: GatewayEvidence[]): { verdict: Verdict; note: string | null } {
  let verdict: Verdict = "SAFE"
  let note: string | null = null
  for (const e of evidence) {
    // A scan we could not trust must not read as a pass. degraded/failed → UNKNOWN;
    // partial → REVIEW. complete contributes nothing (evidence never upgrades).
    if (e.completeness === "degraded" || e.completeness === "failed") {
      if (VERDICT_SEVERITY.UNKNOWN > VERDICT_SEVERITY[verdict]) {
        verdict = "UNKNOWN"
        note = `external evidence from ${e.provider} is ${e.completeness} — cannot yield SAFE`
      }
    } else if (e.completeness === "partial") {
      if (VERDICT_SEVERITY.REVIEW > VERDICT_SEVERITY[verdict]) {
        verdict = "REVIEW"
        note = `external evidence from ${e.provider} is partial`
      }
    }
  }
  return { verdict, note }
}

/**
 * Decide over an Authority Manifest under a policy → `calllint.decision.v0`.
 * Deterministic and fail-closed. The digest seals the whole object minus itself.
 */
export function decideOverAuthority(input: DecideInput): TrustDecision {
  const { authority, policy } = input
  const evidence = input.evidence ?? []

  // 1. Per-capability contributions: base (from approval requirement) tightened by policy.
  const capabilityReasons = authority.capabilities.map((c) => {
    const code = reasonCodeFor(c)
    const contributes = moreSevere(baseVerdict(c), policyFloor(code, policy))
    return { code, evidenceSource: c.evidenceSource, contributes }
  })

  // Static toxic-flow reasons (ADR 0040 §1 / 0044), pre-folded at the edge. They join the
  // capability reasons and aggregate under the SAME rule — a dangerous flow RAISES the
  // verdict, never lowers it. An ALLOW flow was already dropped by foldFlowsIntoReasons.
  const flowReasons = input.flowReasons ?? []
  const reasons = [...capabilityReasons, ...flowReasons]

  // 2. Completeness gaps force UNKNOWN — silence is never SAFE.
  const unknowns: string[] = [...authority.unknowns]
  const contributions: Verdict[] = reasons.map((r) => r.contributes)

  if (authority.subject.artifactDigest === null) {
    contributions.push("UNKNOWN")
    unknowns.push("decision made over an unpinned artifact (no digest)")
  }
  if (authority.completeness === "partial") {
    contributions.push("UNKNOWN")
    unknowns.push("authority manifest is partial — capabilities may be under-counted")
  }
  const ev = evidenceFloor(evidence)
  if (ev.verdict !== "SAFE") {
    contributions.push(ev.verdict)
    if (ev.note) unknowns.push(ev.note)
  }

  const verdict = mostSevereVerdict(contributions)

  // 3. Deterministic ordering: by frozen code order, then evidenceSource, then severity.
  const order = (c: ReasonCode) => REASON_CODES.indexOf(c)
  const sortedReasons = dedupeReasons(reasons).sort(
    (a, b) =>
      order(a.code) - order(b.code) ||
      cmp(a.evidenceSource, b.evidenceSource) ||
      VERDICT_SEVERITY[b.contributes] - VERDICT_SEVERITY[a.contributes],
  )

  const completeness =
    authority.completeness === "partial" || unknowns.length > 0 || ev.verdict === "UNKNOWN"
      ? "partial"
      : "complete"

  const evidenceDigests = [...new Set(evidence.map((e) => e.rawReportDigest))].sort()

  const sealed: Omit<TrustDecision, "digest"> = {
    schema: DECISION_SCHEMA_VERSION,
    artifactDigest: authority.subject.artifactDigest,
    authorityDigest: authority.digest,
    policyDigest: hashJson(policy),
    evidenceDigests,
    verdict,
    reasons: sortedReasons,
    requiredApprovals: [...authority.approval.required].sort(),
    unknowns: [...new Set(unknowns)].sort(),
    completeness,
  }
  return { ...sealed, digest: hashJson(sealed) as `sha256:${string}` }
}

/** Collapse duplicate (code, evidenceSource) reasons, keeping the most severe contribution. */
function dedupeReasons(
  reasons: TrustDecision["reasons"],
): TrustDecision["reasons"] {
  const byKey = new Map<string, TrustDecision["reasons"][number]>()
  for (const r of reasons) {
    const k = `${r.code}|${r.evidenceSource}`
    const prev = byKey.get(k)
    if (!prev || VERDICT_SEVERITY[r.contributes] > VERDICT_SEVERITY[prev.contributes]) {
      byKey.set(k, r)
    }
  }
  return [...byKey.values()]
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Recompute a decision's digest and compare (tamper check for downstream consumers). */
export function verifyDecisionDigest(decision: TrustDecision): boolean {
  const { digest, ...rest } = decision
  return digest === hashJson(rest)
}
