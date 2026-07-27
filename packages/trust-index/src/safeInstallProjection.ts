// ---------------------------------------------------------------------------
// Phase 2.4 Batch 1 — Safe-install projection (ADR 0056; plan §8.2/§8.3).
//
// PURE + deterministic. ONE projection object per baked resource that feeds the
// Human Install HTML, the machine Contract JSON, and the MCP Resource (INV-2.4-01
// — one baked fact object drives every surface). No renderer, no I/O, no clock,
// no LLM (INV-K). Batches 2/3/6 CONSUME this; they never re-derive the verdict.
//
// installability is the human/route enum (plan §8.3 + §F verdict→route matrix),
// distinct from the contract's recommendedNextAction (which is the machine route):
//   SAFE→PREPARE_AVAILABLE · REVIEW→REVIEW_REQUIRED · BLOCK→BLOCKED ·
//   UNKNOWN→LOCAL_PREFLIGHT_REQUIRED · unsupported→UNSUPPORTED.
// ---------------------------------------------------------------------------

import type { BakedTrustPage } from "./bakeTrustPage.js"
import type { Verdict } from "@calllint/types"
import { VERDICT_PUBLIC_LABEL } from "@calllint/types"
import { hashJson } from "@calllint/fingerprint"
import {
  selectDecisionAuthorities,
  type DecisionAuthorityFact,
} from "./selectDecisionAuthorities.js"
import {
  buildAgentAdoptionContract,
  sealAgentAdoptionContract,
  type AdoptionSubjectInput,
  type AgentAdoptionContractV1,
} from "./agentAdoptionContract.js"

export type Installability =
  | "PREPARE_AVAILABLE"
  | "REVIEW_REQUIRED"
  | "BLOCKED"
  | "LOCAL_PREFLIGHT_REQUIRED"
  | "UNSUPPORTED"

/** The human primary-CTA copy per state (plan §6.4/§6.7). Deterministic, closed. */
const PRIMARY_CTA: Record<Installability, string> = {
  PREPARE_AVAILABLE: "Add with CallLint",
  REVIEW_REQUIRED: "Review and add",
  BLOCKED: "Inspect blockers",
  LOCAL_PREFLIGHT_REQUIRED: "Run local pre-flight",
  UNSUPPORTED: "View manual setup",
}

/** Human disposition = headline + one primary CTA (never a generic "Install"). */
export interface HumanDispositionProjection {
  readonly headline: string
  readonly primaryCta: string
}

export interface SafeInstallProjectionInput {
  readonly page: BakedTrustPage
  readonly subject: AdoptionSubjectInput
  readonly snapshotDigest: string
  readonly registrySnapshotDigest: string
  readonly evidenceDigest: string
  readonly engineVersion: string
  /** true when no supported host install plan exists for this target (§8.4). */
  readonly unsupported?: boolean
}

export interface SafeInstallProjection {
  readonly canonicalName: string
  readonly canonicalSlug: string
  readonly displayName: string
  readonly subject: AdoptionSubjectInput
  readonly publicObservation: {
    readonly verdict: Verdict
    readonly publicLabel: string
  }
  readonly authorityDecisionFacts: readonly DecisionAuthorityFact[]
  readonly consequenceSummary: string
  readonly humanDisposition: HumanDispositionProjection
  readonly agentContract: AgentAdoptionContractV1
  readonly installability: Installability
}

/** Map the shipped verdict to the human/route installability enum (plan §8.3/§F). */
function toInstallability(verdict: Verdict, unsupported: boolean): Installability {
  if (unsupported) return "UNSUPPORTED"
  switch (verdict) {
    case "SAFE":
      return "PREPARE_AVAILABLE"
    case "REVIEW":
      return "REVIEW_REQUIRED"
    case "BLOCK":
      return "BLOCKED"
    case "UNKNOWN":
      return "LOCAL_PREFLIGHT_REQUIRED"
  }
}

/**
 * Project one baked page into the single Safe-install fact object. Pure: same
 * input ⇒ deep-equal output, and the embedded contract is byte-identical when
 * re-serialized (its digest is sealed via the shipped hashJson).
 */
export function safeInstallProjection(input: SafeInstallProjectionInput): SafeInstallProjection {
  const page = input.page
  const unsupported = input.unsupported === true
  const selection = selectDecisionAuthorities(page)
  const installability = toInstallability(page.verdict, unsupported)

  const contract = sealAgentAdoptionContract(
    buildAgentAdoptionContract({
      page,
      subject: input.subject,
      selection,
      snapshotDigest: input.snapshotDigest,
      registrySnapshotDigest: input.registrySnapshotDigest,
      evidenceDigest: input.evidenceDigest,
      engineVersion: input.engineVersion,
      unsupported,
    }),
    hashJson,
  )

  return {
    canonicalName: input.subject.canonicalName,
    canonicalSlug: input.subject.canonicalSlug,
    displayName: input.subject.packageName ?? input.subject.canonicalName,
    subject: input.subject,
    publicObservation: {
      verdict: page.verdict,
      publicLabel: VERDICT_PUBLIC_LABEL[page.verdict],
    },
    authorityDecisionFacts: selection.facts,
    consequenceSummary: selection.consequenceSummary,
    humanDisposition: {
      headline: VERDICT_PUBLIC_LABEL[page.verdict],
      primaryCta: PRIMARY_CTA[installability],
    },
    agentContract: contract,
    installability,
  }
}
