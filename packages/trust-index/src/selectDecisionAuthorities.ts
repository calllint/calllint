// ---------------------------------------------------------------------------
// Phase 2.4 Batch 1 — deterministic top-three authority selector (ADR 0056; plan §6.6).
//
// PURE + deterministic. Projects the shipped, frozen reason-code vocabulary
// (@calllint/types REASON_CODES) onto a small, closed lowercase CONSEQUENCE
// vocabulary for the acquisition surface. This is a rendering projection of an
// already-shipped set (exactly as reason codes themselves project findings —
// ADR 0020), NOT a forked authority model: the verdict, the reason codes, and
// the risk engine are untouched (INV-2.4-01/10). No LLM, no free text, no clock.
//
// The selector answers one question for the human capsule: "what are the at-most
// three authority facts that matter for THIS decision?" — highest observed
// consequence first, at most one meaningful absence, and only when evidence
// supports that absence (completeness === "complete"). "not observed" is NEVER
// rendered as "impossible" (plan §6.6; INV vocabulary rule §4.1).
// ---------------------------------------------------------------------------

import type { BakedTrustPage } from "./bakeTrustPage.js"
import type { Finding, ReasonCode } from "@calllint/types"
import { findingsToReasonCodes } from "@calllint/core"

/**
 * Closed lowercase consequence vocabulary (plan §6.6 priority list). Each token
 * is a user-facing CONSEQUENCE name deterministically mapped from a shipped
 * reason code; `no_high_authority_observed` is the honest sentinel used only
 * when nothing high-authority was observed. Do NOT coin synonyms (§4.1).
 */
export const ADOPTION_AUTHORITIES = [
  "financial_action",
  "secret_access",
  "shell_execution",
  "broad_filesystem_access",
  "external_mutation",
  "messaging_send",
  "oauth_scope",
  "gateway_runtime",
  "network_egress",
  "no_high_authority_observed",
] as const

export type AdoptionAuthority = (typeof ADOPTION_AUTHORITIES)[number]

/**
 * The deterministic 1:1 projection from a shipped reason code to its consequence
 * authority. Only the nine CAPABILITY reason codes map; the four non-capability
 * codes (UNPINNED_PACKAGE, PROMPT_METADATA_INSTRUCTION, TOOL_DESCRIPTOR_CHANGED,
 * TOXIC_FLOW_COMPOSITION) are surfaced as reason codes elsewhere, never as an
 * authority fact — so they are intentionally absent here.
 */
const REASON_CODE_TO_AUTHORITY: Partial<Record<ReasonCode, AdoptionAuthority>> = {
  MONEY_OR_PAYMENT_CAPABILITY: "financial_action",
  SECRET_IN_WORKSPACE_CONFIG: "secret_access",
  SHELL_OR_DOCKER_EXECUTION: "shell_execution",
  BROAD_FILESYSTEM_ACCESS: "broad_filesystem_access",
  EXTERNAL_MUTATION_UNKNOWN: "external_mutation",
  MESSAGING_OR_EMAIL_SEND: "messaging_send",
  OAUTH_SCOPE_UNKNOWN_OR_EXPANDED: "oauth_scope",
  LONG_RUNNING_GATEWAY_RUNTIME: "gateway_runtime",
  UNKNOWN_REMOTE: "network_egress",
}

/** Priority rank (lower = more consequential). Drives selection + stable order. */
const AUTHORITY_RANK: Record<AdoptionAuthority, number> = Object.fromEntries(
  ADOPTION_AUTHORITIES.map((a, i) => [a, i]),
) as Record<AdoptionAuthority, number>

/** User-consequence sentence for an OBSERVED authority (plan §6.5; never marketing). */
const OBSERVED_CONSEQUENCE: Record<AdoptionAuthority, string> = {
  financial_action: "Can initiate payments or financial actions.",
  secret_access: "Requires access to configured secrets.",
  shell_execution: "Can run shell commands with access to configured paths.",
  broad_filesystem_access: "Can read and write across a broad filesystem scope.",
  external_mutation: "Can create and update external records.",
  messaging_send: "Can send messages on your behalf.",
  oauth_scope: "Requests OAuth scopes that may be broad or unverified.",
  gateway_runtime: "Runs as a long-lived gateway process.",
  network_egress: "Connects to an unverified remote endpoint.",
  no_high_authority_observed: "No high-authority capability was observed.",
}

/** Neutral ABSENCE sentence — an observation, never "impossible" (§6.6; §4.1). */
const ABSENCE_CONSEQUENCE: Record<AdoptionAuthority, string> = {
  financial_action: "No financial or payment capability was observed.",
  secret_access: "No secret access was observed.",
  shell_execution: "No shell or command execution was observed.",
  broad_filesystem_access: "No broad filesystem access was observed.",
  external_mutation: "No external mutation was observed.",
  messaging_send: "No message-sending capability was observed.",
  oauth_scope: "No OAuth scope request was observed.",
  gateway_runtime: "No long-lived gateway runtime was observed.",
  network_egress: "No unverified network egress was observed.",
  no_high_authority_observed: "No high-authority capability was observed.",
}

/** One authority fact for the human capsule (≤3 shown) + the machine delta. */
export interface DecisionAuthorityFact {
  readonly authority: AdoptionAuthority
  /** true = observed in evidence; false = a meaningful, evidence-supported absence. */
  readonly observed: boolean
  /** Deterministic user-consequence sentence (never "impossible" for absences). */
  readonly consequence: string
}

/** The selector output: ≤3 facts (observed-first) + a one-sentence summary. */
export interface DecisionAuthoritySelection {
  readonly facts: readonly DecisionAuthorityFact[]
  readonly consequenceSummary: string
  /** All observed authorities, priority-ordered (drives the machine authorityDelta.adds). */
  readonly observedAuthorities: readonly AdoptionAuthority[]
}

/** Aggregate the frozen reason codes across every server report on a baked page. */
function pageReasonCodes(page: BakedTrustPage): ReasonCode[] {
  const findings: Finding[] = []
  for (const report of page.scan.reports ?? []) {
    for (const f of report.findings ?? []) findings.push(f)
  }
  return findingsToReasonCodes(findings)
}

/**
 * Select the at-most-three authority facts that matter for this decision.
 *
 * Rules (plan §6.6): highest observed consequence first; at most ONE meaningful
 * absence, and only when the evidence is complete enough to assert it; never
 * more than three facts; absences are observations, never "impossible".
 */
export function selectDecisionAuthorities(page: BakedTrustPage): DecisionAuthoritySelection {
  const codes = pageReasonCodes(page)
  const observed = ADOPTION_AUTHORITIES.filter(
    (a): a is AdoptionAuthority =>
      a !== "no_high_authority_observed" &&
      codes.some((c) => REASON_CODE_TO_AUTHORITY[c] === a),
  ).sort((x, y) => AUTHORITY_RANK[x] - AUTHORITY_RANK[y])

  // Absence is assertable only when the authority inventory is complete — otherwise
  // silence is a gap, not evidence of absence (never over-trust silence).
  const complete = (page.preparation.authority?.completeness ?? "partial") === "complete"

  const facts: DecisionAuthorityFact[] = observed
    .slice(0, 3)
    .map((authority) => ({ authority, observed: true, consequence: OBSERVED_CONSEQUENCE[authority] }))

  // Fill remaining slots (up to 3 total) with ONE meaningful, evidence-supported absence.
  if (facts.length < 3 && complete) {
    const absence = ADOPTION_AUTHORITIES.find(
      (a) => a !== "no_high_authority_observed" && !observed.includes(a),
    )
    if (absence) {
      facts.push({ authority: absence, observed: false, consequence: ABSENCE_CONSEQUENCE[absence] })
    }
  }

  // Honest sentinel when nothing high-authority was observed at all.
  if (facts.length === 0) {
    facts.push({
      authority: "no_high_authority_observed",
      observed: false,
      consequence: OBSERVED_CONSEQUENCE.no_high_authority_observed,
    })
  }

  const top = observed[0]
  const summary =
    top !== undefined
      ? OBSERVED_CONSEQUENCE[top]
      : OBSERVED_CONSEQUENCE.no_high_authority_observed

  return { facts, consequenceSummary: summary, observedAuthorities: observed }
}

