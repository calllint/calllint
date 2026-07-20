/**
 * Publish eligibility + completeness + UNKNOWN explanation (new11 P1 §4.3/§4.5/§4.7).
 * PURE — derives everything from an EvidenceBundle; no I/O, no clock.
 *
 * §4.7 gates the public Trust Index: an object may be published ONLY when its
 * identity is stably resolved, it has an exact version or immutable digest, the
 * report is reproducible, its gaps are explainable, it carries no private info,
 * and its verdict is bound to THIS bundle. This module makes that gate a single
 * pure function so no surface can publish an unidentifiable object.
 *
 * §4.5 forbids equating a network/resolution failure with an analysis UNKNOWN.
 * explainUnknown separates resolution-failure / conflicting-evidence /
 * unresolvable-identity / incomplete so the surface says the RIGHT reason.
 */
import { EVIDENCE_GAP_META } from "./reasonCodes.js"
import type { GapCategory } from "./reasonCodes.js"
import { hasBlockingGap, isCleanlyResolved } from "./bundle.js"
import type { EvidenceBundle } from "./types.js"

/** Fields that, taken together, satisfy "exact version or immutable digest" (§4.7). */
const VERSION_FIELDS = ["identity.version", "identity.integrity"]

/** Item fields we refuse to publish — a structural PII guard (§4.7 "no private info"). */
const PII_FIELD_PATTERN = /(^|\.)(email|phone|contact|whois|owner_?email|address)($|\.)/i

/** One §4.7 criterion outcome. */
export interface EligibilityCriterion {
  id: string
  met: boolean
  detail: string
}

export interface EligibilityReport {
  eligible: boolean
  criteria: EligibilityCriterion[]
  /** ids of the unmet criteria, in declaration order (empty ⇒ eligible). */
  blockers: string[]
}

/**
 * Evaluate the six §4.7 criteria. `verdictBound` is asserted by the caller (the
 * verdict lives above the evidence layer); it defaults to false so a caller that
 * forgets to bind a verdict fails CLOSED rather than publishing unbound.
 */
export function evaluatePublishEligibility(
  bundle: EvidenceBundle,
  opts: { verdictBound?: boolean } = {},
): EligibilityReport {
  const has = (field: string) => bundle.items.some((i) => i.field === field)
  const digestBound = bundle.subject.artifactDigest != null || has("identity.integrity")

  const criteria: EligibilityCriterion[] = [
    {
      id: "identity-stable",
      met: bundle.subject.id.length > 0 && has("identity.name"),
      detail: "subject identity resolves to a stable name",
    },
    {
      id: "exact-version-or-digest",
      met: digestBound || VERSION_FIELDS.some(has),
      detail: "an exact version or immutable digest is present",
    },
    {
      id: "reproducible",
      met: bundle.state === "COMPLETE" && !hasBlockingGap(bundle.gaps),
      detail: "resolution is COMPLETE with no blocking gap (report is reproducible)",
    },
    {
      id: "gaps-explainable",
      met: bundle.gaps.every((g) => g.code in EVIDENCE_GAP_META),
      detail: "every gap carries a known, explainable reason code",
    },
    {
      id: "no-private-info",
      met: !bundle.items.some((i) => PII_FIELD_PATTERN.test(i.field)),
      detail: "no evidence field exposes private/contact information",
    },
    {
      id: "verdict-bound",
      met: opts.verdictBound === true,
      detail: "a verdict is bound to this evidence bundle",
    },
  ]

  const blockers = criteria.filter((c) => !c.met).map((c) => c.id)
  return { eligible: blockers.length === 0, criteria, blockers }
}

/** A single explained gap for the completeness report. */
export interface ReportedGap {
  code: string
  category: GapCategory
  severity: "blocking" | "degrading"
  userMessage: string
  maintainerAction: string | null
  retryable: boolean
  detail: string
}

export interface CompletenessReport {
  state: EvidenceBundle["state"]
  clean: boolean
  /** Fields that resolved, sorted. */
  resolvedFields: string[]
  /** Union of every gap's missingFields, sorted + deduped. */
  missingFields: string[]
  gaps: ReportedGap[]
  /** True if at least one gap is retryable (a later run may close it). */
  anyRetryable: boolean
  /** True if at least one gap names a maintainer action. */
  anyMaintainerFixable: boolean
}

/** Build the human-facing completeness report from a bundle (§4.3). Deterministic. */
export function completenessReport(bundle: EvidenceBundle): CompletenessReport {
  const gaps: ReportedGap[] = bundle.gaps.map((g) => {
    const meta = EVIDENCE_GAP_META[g.code]
    return {
      code: g.code,
      category: meta.category,
      severity: meta.severity,
      userMessage: meta.userMessage,
      maintainerAction: meta.maintainerAction,
      retryable: meta.retryable,
      detail: g.detail,
    }
  })
  const missing = new Set<string>()
  for (const g of bundle.gaps) for (const f of g.missingFields) missing.add(f)
  return {
    state: bundle.state,
    clean: isCleanlyResolved(bundle),
    resolvedFields: bundle.items.map((i) => i.field).sort(),
    missingFields: [...missing].sort(),
    gaps,
    anyRetryable: gaps.some((g) => g.retryable),
    anyMaintainerFixable: gaps.some((g) => g.maintainerAction !== null),
  }
}

/**
 * Why an object is NOT cleanly resolved (§4.5). CRITICAL: a network/resolution
 * failure is NOT an analysis UNKNOWN — the surface must say the right thing.
 *   - "resolution-failure": transient (retryable) — a later run may resolve it.
 *   - "conflicting-evidence": equal-tier disagreement — needs a human/maintainer.
 *   - "unresolvable-identity": permanently unidentifiable (e.g. PACKAGE_NOT_FOUND).
 *   - "incomplete": resolved but with degrading gaps (partial completeness).
 *   - "clean": actually cleanly resolved — no UNKNOWN to explain.
 */
export type UnknownCause =
  | "clean"
  | "resolution-failure"
  | "conflicting-evidence"
  | "unresolvable-identity"
  | "incomplete"

export interface UnknownExplanation {
  cause: UnknownCause
  /** True only for resolution-failure — the surface may offer "retry". */
  retryable: boolean
  summary: string
}

export function explainUnknown(bundle: EvidenceBundle): UnknownExplanation {
  if (isCleanlyResolved(bundle)) {
    return { cause: "clean", retryable: false, summary: "identity resolved cleanly" }
  }
  if (bundle.state === "RETRYABLE_FAILURE") {
    return {
      cause: "resolution-failure",
      retryable: true,
      summary: "an upstream was unreachable — this is a resolution failure, not an analysis result",
    }
  }
  if (bundle.gaps.some((g) => g.code === "CONFLICTING_EVIDENCE")) {
    return {
      cause: "conflicting-evidence",
      retryable: false,
      summary: "sources disagree at equal priority — resolved fields were withheld",
    }
  }
  if (bundle.state === "UNRESOLVABLE") {
    return {
      cause: "unresolvable-identity",
      retryable: false,
      summary: "the subject could not be identified from any resolver",
    }
  }
  return {
    cause: "incomplete",
    retryable: bundle.gaps.some((g) => EVIDENCE_GAP_META[g.code].retryable),
    summary: "identity resolved but some evidence is missing",
  }
}
