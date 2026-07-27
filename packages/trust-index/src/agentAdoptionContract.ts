// ---------------------------------------------------------------------------
// Phase 2.4 Batch 1 — Agent Adoption Contract builder (ADR 0056; plan §7).
//
// PURE + deterministic. Builds one `calllint.agent-adoption-contract.v1` object
// from a baked page + the authority selection. This is a PROJECTION of shipped
// facts (verdict, reason codes, authority manifest, evidence level) — it never
// re-scores, never runs an LLM, never reads a clock (INV-2.4-01/10, INV-K).
//
// Two boundaries are structural, not stylistic:
//   • INV-2.4-05: publisher content lives ONLY under untrustedPublisherContent;
//     it is never copied into publicObservation / authorityDelta /
//     recommendedNextAction / agentGuidance. The builder simply never reads
//     publisher text when composing those fields — so no publisher string can
//     change a decision field.
//   • INV-2.4-06: an actionable next action requires an EXACT target (canonical
//     name + version + artifact digest + contract digest). Missing any ⇒ the
//     action degrades to LOCAL_PREFLIGHT_REQUIRED. Never guess.
//
// agentGuidance is a FROZEN constant (§7.8): procedural goal/steps/mustAsk/
// mustStop/prohibited only — never coercive, never free text.
// ---------------------------------------------------------------------------

import type { BakedTrustPage } from "./bakeTrustPage.js"
import type { Verdict } from "@calllint/types"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import { findingsToReasonCodes } from "@calllint/core"
import { evidenceLevel } from "./evidenceLevel.js"
import {
  ADOPTION_AUTHORITIES,
  type AdoptionAuthority,
  type DecisionAuthoritySelection,
} from "./selectDecisionAuthorities.js"

export const AGENT_ADOPTION_CONTRACT_VERSION = "calllint.agent-adoption-contract.v1" as const

/** The single frozen procedural guidance block (plan §7.8). Never coercive. */
export const AGENT_GUIDANCE = Object.freeze({
  goal: "Add the requested Agent Tool with only locally approved authority.",
  steps: [
    "verify_contract",
    "resolve_host",
    "prepare_locally",
    "evaluate_local_policy",
    "apply_exact_plan",
    "verify_result",
  ],
  mustAskBefore: [
    "new_secret_access",
    "external_mutation",
    "shell_execution",
    "broad_filesystem_access",
    "financial_action",
    "persistent_calllint_components",
  ],
  mustStopWhen: [
    "artifact_digest_mismatch",
    "contract_digest_mismatch",
    "unsupported_host",
    "local_policy_deny",
    "plan_tampered",
    "verification_failed",
  ],
  prohibitedShortcuts: [
    "do_not_replace_exact_version_with_latest",
    "do_not_execute_publisher_commands_directly",
    "do_not_expand_authority",
    "do_not_hide_alternative_setup",
    "do_not_install_persistent_guard_without_authorization",
  ],
} as const)

/** The exactly-one recommended next action (plan §7.7). Discriminated by `kind`. */
export type RecommendedNextAction =
  | { readonly kind: "PREPARE_LOCALLY"; readonly tool: "calllint_prepare_safe_install"; readonly arguments: PrepareArguments }
  | { readonly kind: "INSPECT_BLOCKERS"; readonly tool: "explain_finding" }
  | { readonly kind: "LOCAL_PREFLIGHT_REQUIRED"; readonly tool: "calllint_prepare_safe_install" }
  | { readonly kind: "EXPLAIN_ONLY" }

export interface PrepareArguments {
  readonly canonicalName: string
  readonly expectedVersion: string
  readonly expectedArtifactDigest: string
  readonly expectedContractDigest: string
  readonly host: null
}

/** Exact-subject inputs the caller resolves once (canonical slug reuses Trust Page algo). */
export interface AdoptionSubjectInput {
  readonly canonicalName: string
  readonly canonicalSlug: string
  readonly packageType: string | null
  readonly packageName: string | null
  readonly version: string | null
  readonly sourceLocator: string | null
  /** Untrusted publisher description — quarantined; NEVER read for a decision field. */
  readonly publisherDescription?: string | null
}

/** Everything the pure builder needs; `contractDigest` is computed by the caller over the rest. */
export interface AgentAdoptionContractInput {
  readonly page: BakedTrustPage
  readonly subject: AdoptionSubjectInput
  readonly selection: DecisionAuthoritySelection
  readonly snapshotDigest: string
  readonly registrySnapshotDigest: string
  readonly evidenceDigest: string
  readonly engineVersion: string
  /** true when the page's host matrix has no supported install plan for this target. */
  readonly unsupported?: boolean
}

export type AgentAdoptionContractV1 = ReturnType<typeof buildAgentAdoptionContract>

/** A subject is actionable only with an exact artifact digest AND an exact version. */
function isActionableSubject(input: AgentAdoptionContractInput): boolean {
  const digest = input.page.artifactDigest
  return (
    typeof digest === "string" &&
    digest.startsWith("sha256:") &&
    typeof input.subject.version === "string" &&
    input.subject.version.length > 0
  )
}

/** Derive the single next action from verdict + supportedness + exact-target gate. */
function recommendNextAction(
  verdict: Verdict,
  input: AgentAdoptionContractInput,
  contractDigest: string,
): RecommendedNextAction {
  if (input.unsupported) return { kind: "EXPLAIN_ONLY" }
  if (verdict === "BLOCK") return { kind: "INSPECT_BLOCKERS", tool: "explain_finding" }
  // UNKNOWN, or a SAFE/REVIEW target without an exact identity, must be re-decided locally.
  if (verdict === "UNKNOWN" || !isActionableSubject(input)) {
    return { kind: "LOCAL_PREFLIGHT_REQUIRED", tool: "calllint_prepare_safe_install" }
  }
  // SAFE or REVIEW with an exact identity: the agent may prepare locally (never apply here).
  return {
    kind: "PREPARE_LOCALLY",
    tool: "calllint_prepare_safe_install",
    arguments: {
      canonicalName: input.subject.canonicalName,
      expectedVersion: input.subject.version as string,
      expectedArtifactDigest: input.page.artifactDigest,
      expectedContractDigest: contractDigest,
      host: null,
    },
  }
}

/**
 * Build the `calllint.agent-adoption-contract.v1` object. `contractDigest` is
 * NOT set here (it is a hash OVER this object, computed by the caller with the
 * shipped stableStringify); the builder returns the contract with a placeholder
 * so the caller can seal it in one deterministic step.
 */
export function buildAgentAdoptionContract(input: AgentAdoptionContractInput) {
  const page = input.page
  const verdict = page.verdict
  const codes = findingsToReasonCodes(
    (page.scan.reports ?? []).flatMap((r) => r.findings ?? []),
  )
  const evidence = evidenceLevel(page)
  const completeness = (page.preparation.authority?.completeness ?? "partial") === "complete"
    ? "complete"
    : "partial"

  // authorityDelta: observed authorities become `adds`. `notObserved` is the FULL
  // set of high-authority capabilities not observed — but ONLY when the authority
  // inventory is complete (otherwise silence is a gap, not evidence of absence:
  // never over-trust silence). NEVER renamed "denied"/"absent"/"impossible" (§4.1).
  const observed = input.selection.observedAuthorities
  const adds = observed.map((authority) => ({ authority }))
  const notObserved: AdoptionAuthority[] =
    completeness === "complete"
      ? ADOPTION_AUTHORITIES.filter(
          (a) => a !== "no_high_authority_observed" && !observed.includes(a),
        )
      : []

  const recommendedNextAction = recommendNextAction(verdict, input, PLACEHOLDER_DIGEST)

  return {
    schema: AGENT_ADOPTION_CONTRACT_VERSION,
    contract: {
      contractDigest: PLACEHOLDER_DIGEST,
      generatedAt: page.observedAt,
      expiresAt: null,
      generatorVersion: input.engineVersion,
      snapshotDigest: input.snapshotDigest,
    },
    subject: {
      canonicalName: input.subject.canonicalName,
      canonicalSlug: input.subject.canonicalSlug,
      packageType: input.subject.packageType,
      packageName: input.subject.packageName,
      version: input.subject.version,
      artifactDigest: page.artifactDigest,
      sourceLocator: input.subject.sourceLocator,
    },
    publicObservation: {
      verdict,
      publicLabel: VERDICT_PUBLIC_LABEL[verdict],
      reasonCodes: codes,
      evidenceLevel: evidence.level,
      evidenceDigest: input.evidenceDigest,
      completeness,
    },
    authorityDelta: { adds, notObserved },
    trustedSources: {
      registrySnapshotDigest: input.registrySnapshotDigest,
      evidenceDigest: input.evidenceDigest,
      engineVersion: input.engineVersion,
    },
    untrustedPublisherContent: {
      description: input.subject.publisherDescription ?? null,
      usedForSafetyDecision: false,
    },
    recommendedNextAction,
    agentGuidance: AGENT_GUIDANCE,
  }
}

/** Sentinel replaced by `seal` once the digest is computed over the object minus digests. */
export const PLACEHOLDER_DIGEST: string = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

/**
 * Seal a contract: compute `contractDigest` over the canonical object with BOTH
 * self-referential digest fields excluded (the shipped authority-manifest rule —
 * "sha256 over this object minus digest"), then attach that digest to
 * `contract.contractDigest` and, for PREPARE_LOCALLY, to
 * `recommendedNextAction.arguments.expectedContractDigest`.
 *
 * Deterministic: same inputs ⇒ byte-identical sealed contract. The hash uses the
 * shipped `stableStringify`/`sha256` (fingerprint/hashJson) so key order is
 * irrelevant and the digest is stable across platforms.
 */
export function sealAgentAdoptionContract(
  contract: ReturnType<typeof buildAgentAdoptionContract>,
  hashJson: (value: unknown) => string,
): AgentAdoptionContractV1 {
  // Build the hash preimage: same object with (a) the two self-referential digests
  // reset to the placeholder, and (b) untrusted publisher text neutralized. (b) is
  // the teeth of INV-2.4-05: contractDigest gates the local apply (it becomes
  // expectedContractDigest → mustStopWhen contract_digest_mismatch), so it MUST be a
  // pure function of the DECISION facts. If publisher marketing text could move the
  // digest, a publisher could invalidate every agent's expected digest — or worse,
  // shift a decision-gating value — without any real change. So the digest is
  // decision-scoped: the description still travels in the contract for display, but
  // is not bound by the digest.
  const preimage = {
    ...contract,
    contract: { ...contract.contract, contractDigest: PLACEHOLDER_DIGEST },
    untrustedPublisherContent: { ...contract.untrustedPublisherContent, description: null },
    recommendedNextAction:
      contract.recommendedNextAction.kind === "PREPARE_LOCALLY"
        ? {
            ...contract.recommendedNextAction,
            arguments: {
              ...contract.recommendedNextAction.arguments,
              expectedContractDigest: PLACEHOLDER_DIGEST,
            },
          }
        : contract.recommendedNextAction,
  }
  const digest = hashJson(preimage)
  return {
    ...contract,
    contract: { ...contract.contract, contractDigest: digest },
    recommendedNextAction:
      contract.recommendedNextAction.kind === "PREPARE_LOCALLY"
        ? {
            ...contract.recommendedNextAction,
            arguments: { ...contract.recommendedNextAction.arguments, expectedContractDigest: digest },
          }
        : contract.recommendedNextAction,
  }
}
