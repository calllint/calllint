// ---------------------------------------------------------------------------
// Phase 2.4 Batch 1 — deterministic top-N authority selector (ADR 0056; plan §6.6).
//
// PURE + deterministic. Projects the shipped, frozen reason-code vocabulary
// (@calllint/types REASON_CODES) onto a small, closed lowercase CONSEQUENCE
// vocabulary for the acquisition surface. This is a rendering projection of an
// already-shipped set (exactly as reason codes themselves project findings —
// ADR 0020), NOT a forked authority model: the verdict, the reason codes, and
// the risk engine are untouched (INV-2.4-01/10). No LLM, no free text, no clock.
//
// The selector answers one question for the human capsule: "what are the at-most
// MAX_DECISION_AUTHORITY_FACTS authority facts that matter for THIS decision?" —
// highest observed consequence first, at most one meaningful absence, and only when
// evidence supports that absence (completeness === "complete"). "not observed" is
// NEVER rendered as "impossible" (plan §6.6; INV vocabulary rule §4.1).
//
// That cap is 5 (ADR 0059, mirrored by SHIPPED_LAYOUT_CAPS.maxAuthorityFacts). The
// earlier "top three" of new15 §14 / plan §6.6 is SUPERSEDED — all five canonical
// fixtures measure exactly 5 facts, so a 3 was unsatisfiable rather than merely
// stale. `pnpm audit:preview` grades the measured counts against the declared
// threshold, so the number cannot drift back silently.
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

/**
 * User-consequence sentence for an OBSERVED authority (plan §6.5; never marketing).
 *
 * Exported for the Workstream P presentation audit (ADR 0058 §1), which must probe
 * these exact strings to MEASURE that they cannot reach `contractDigest`. The audit
 * reading the real constant — rather than a copy — is what keeps the measurement
 * bound to the shipped bytes. This is L2 security-explanation copy, lifted by PR P-2
 * into the merged presentation document's `authorityCopy.observedPhrases`.
 *
 * It stays in code as the DEFAULT, not as dead weight: presentation resolves per slot
 * and fails open here, so a missing, partial, or rejected document still renders a
 * complete page (ADR 0058 §5 INV-P3). Configuration supplies wording for a shipped
 * token; it can never add, rename, or coin one.
 */
export const OBSERVED_CONSEQUENCE: Record<AdoptionAuthority, string> = {
  financial_action: "Can initiate payments or financial actions.",
  secret_access: "Requires access to configured secrets.",
  shell_execution: "Can run shell commands with access to configured paths.",
  broad_filesystem_access: "Can read and write across a broad filesystem scope.",
  external_mutation: "Can create and update external records.",
  messaging_send: "Can send messages on your behalf.",
  oauth_scope: "Requests OAuth scopes that may be broad or unverified.",
  gateway_runtime: "Runs as a long-lived gateway process.",
  network_egress: "Your agent could send data to an unverified remote endpoint — CallLint could not inspect what that endpoint does.",
  no_high_authority_observed: "No high-authority capability was observed.",
}

/**
 * Neutral ABSENCE sentence — an observation, never "impossible" (§6.6; §4.1).
 * Exported for the same audit reason as `OBSERVED_CONSEQUENCE`; also L2, and lifted
 * by PR P-2 into `authorityCopy.absencePhrases`. The validator additionally forbids
 * denial vocabulary here, so a config edit cannot turn "not observed" into "cannot".
 */
export const ABSENCE_CONSEQUENCE: Record<AdoptionAuthority, string> = {
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

/** One authority fact for the human capsule (≤5 shown; ADR 0059) + the machine delta. */
export interface DecisionAuthorityFact {
  readonly authority: AdoptionAuthority
  /** true = observed in evidence; false = a meaningful, evidence-supported absence. */
  readonly observed: boolean
  /** Deterministic user-consequence sentence (never "impossible" for absences). */
  readonly consequence: string
}

/** Shipped selection/display ceiling for human-capsule authority rows (ADR 0059). */
export const MAX_DECISION_AUTHORITY_FACTS = 5

/** The selector output: ≤5 facts (observed-first) + a one-sentence summary. */
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
 * The L2 wording slice this selector consumes (PR P-2). A PARAMETER, never an
 * import (ADR 0058 §2): the emit edge reads the document and hands this inward, so
 * nothing under `packages/*` can reach the config plane on its own.
 *
 * Both maps are TOTAL over the shipped authorities because the resolver merges per
 * slot over the code defaults — so this type cannot express a hole, and the selector
 * needs no per-lookup fallback that could silently render an empty sentence.
 */
export interface AuthorityCopy {
  readonly observed: Record<AdoptionAuthority, string>
  readonly absence: Record<AdoptionAuthority, string>
}

/** The shipped defaults as an `AuthorityCopy` — what an absent document resolves to. */
export const DEFAULT_AUTHORITY_COPY: AuthorityCopy = {
  observed: OBSERVED_CONSEQUENCE,
  absence: ABSENCE_CONSEQUENCE,
}

/**
 * Select the at-most-five authority facts that matter for this decision (ADR 0059).
 *
 * Rules: highest observed consequence first; then evidence-supported absences in
 * priority order when the inventory is complete; never more than
 * `MAX_DECISION_AUTHORITY_FACTS`; absences are observations, never "impossible".
 *
 * `copy` is optional L2 wording (PR P-2). Omitting it — which every pre-P-2 caller
 * does — is byte-identical to passing `DEFAULT_AUTHORITY_COPY`. What it can change is
 * only the SENTENCE: the selection itself (which authorities, observed vs absence,
 * their order, the cap, the completeness precondition) is derived from evidence and
 * is unreachable from configuration.
 */
export function selectDecisionAuthorities(
  page: BakedTrustPage,
  copy: AuthorityCopy = DEFAULT_AUTHORITY_COPY,
): DecisionAuthoritySelection {
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
    .slice(0, MAX_DECISION_AUTHORITY_FACTS)
    .map((authority) => ({ authority, observed: true, consequence: copy.observed[authority] }))

  // Fill remaining slots with meaningful, evidence-supported absences (priority order).
  if (complete) {
    for (const absence of ADOPTION_AUTHORITIES) {
      if (facts.length >= MAX_DECISION_AUTHORITY_FACTS) break
      if (absence === "no_high_authority_observed") continue
      if (observed.includes(absence)) continue
      facts.push({ authority: absence, observed: false, consequence: copy.absence[absence] })
    }
  }

  // Honest sentinel when nothing high-authority was observed at all.
  if (facts.length === 0) {
    facts.push({
      authority: "no_high_authority_observed",
      observed: false,
      consequence: copy.observed.no_high_authority_observed,
    })
  }

  const top = observed[0]
  const summary =
    top !== undefined
      ? copy.observed[top]
      : copy.observed.no_high_authority_observed

  return { facts, consequenceSummary: summary, observedAuthorities: observed }
}

