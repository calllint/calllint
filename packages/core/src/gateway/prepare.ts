/**
 * Trust Gateway — read-only preparation (G1 + G2 + G3 + G4).
 *
 * Advances the read-only half of the state machine
 * (DISCOVERED → RESOLVED → FETCHED → EVIDENCE_COLLECTED → AUTHORITY_NORMALIZED →
 * DECIDED) over an already-resolved Artifact Identity plus any attached evidence,
 * authority manifest, and decision. PURE and DETERMINISTIC: no I/O, no wall clock
 * — the CLI edge resolves the artifact, imports evidence, builds the manifest,
 * runs the policy decision, and injects `preparedAt`.
 *
 * G1 populated only the Artifact slot. G2 wires the shipped Evidence Envelope in:
 * evidence is provenance-preserved and NEVER re-scored. G3 records the Authority
 * Manifest (an inventory, never a verdict). G4 records the Policy Decision — the
 * deterministic verdict over that manifest. Each stage can only TIGHTEN the
 * preparation, never loosen it: a failed scan, a partial manifest, or an UNKNOWN
 * verdict never reads as a pass (ADR 0034 / 0035 / 0036).
 *
 * Plan is still a null placeholder (G5).
 */
import type {
  ArtifactIdentity,
  AuthorityManifest,
  GatewayEvidence,
  TrustDecision,
  TrustPreparation,
  TrustPrepareState,
} from "@calllint/types"
import { TRUST_PREPARATION_SCHEMA } from "@calllint/types"

export interface PrepareInput {
  artifact: ArtifactIdentity
  /** Attached external evidence (already imported at the edge; never re-scored). */
  evidence?: GatewayEvidence[]
  /**
   * Authority Manifest (object 3), built at the edge from parsed config + doc
   * surfaces. G3 records it in the authority slot; it is an inventory, NEVER a
   * verdict — the deterministic decision (G4) reads it but does not live here.
   */
  authority?: AuthorityManifest
  /**
   * Policy Decision (object 4), computed at the edge via
   * `decideOverAuthority(manifest, policy)`. G4 records it and advances the state
   * to DECIDED / POLICY_UNKNOWN. Only meaningful when an authority manifest is
   * present and the artifact + evidence gates passed.
   */
  decision?: TrustDecision
  /** ISO-8601 UTC, injected from the CLI edge. */
  preparedAt: string
}

type Completeness = GatewayEvidence["completeness"]
const COMPLETENESS_RANK: Record<Completeness, number> = {
  complete: 0,
  partial: 1,
  degraded: 2,
  failed: 3,
}

/** The worst (highest-rank) completeness across all envelopes. */
function worstCompleteness(evidence: GatewayEvidence[]): Completeness {
  let worst: Completeness = "complete"
  for (const e of evidence) {
    if (COMPLETENESS_RANK[e.completeness] > COMPLETENESS_RANK[worst]) worst = e.completeness
  }
  return worst
}

/**
 * Build a read-only TrustPreparation from a resolved artifact and optional
 * evidence.
 *
 * Artifact gate (G1):
 * - resolution "resolved"  → advance to the evidence stage.
 * - resolution "partial"   → FETCH_REJECTED (not a verified target).
 * - resolution "unresolved"→ RESOLUTION_FAILED (nothing to evaluate).
 *
 * Evidence gate (G2, only reached when the artifact resolved):
 * - no evidence attached    → PLAN_READY (evidence is optional; its absence is
 *                             not a failure, but it is noted).
 * - all evidence complete   → PLAN_READY.
 * - any evidence partial    → EVIDENCE_PARTIAL (exit 10).
 * - any evidence degraded/failed → EVIDENCE_FAILED (exit 20, fail-closed).
 */
export function prepare(input: PrepareInput): TrustPreparation {
  const { artifact, preparedAt } = input
  const evidence = input.evidence ?? []
  const notes: string[] = []

  let state: TrustPrepareState
  if (artifact.resolution === "resolved") {
    // Artifact resolved — evaluate the evidence stage.
    if (evidence.length === 0) {
      state = "PLAN_READY"
      notes.push("no external evidence attached (optional); decision will rely on CallLint's own analysis")
    } else {
      const worst = worstCompleteness(evidence)
      switch (worst) {
        case "complete":
          state = "PLAN_READY"
          break
        case "partial":
          state = "EVIDENCE_PARTIAL"
          notes.push("attached evidence is partial — gaps remain; not a clean pass")
          break
        default:
          state = "EVIDENCE_FAILED"
          notes.push(
            "attached evidence is degraded or failed — fail-closed; a degraded external scan never reads as a pass"
          )
          break
      }
    }
  } else if (artifact.resolution === "partial") {
    state = "FETCH_REJECTED"
    notes.push(
      "artifact could not be fully pinned (missing immutable ref or bytes); not a verified target"
    )
  } else {
    state = "RESOLUTION_FAILED"
    notes.push("artifact could not be resolved to an immutable, digested identity")
  }

  for (const r of artifact.resolutionReasons ?? []) notes.push(r)
  // Surface each provider's degraded reasons so the gap is auditable.
  for (const e of evidence) {
    for (const reason of e.degradedReasons) {
      notes.push(`evidence[${e.provider}]: ${reason}`)
    }
  }

  // G3 — Authority normalization. The manifest is an inventory, not a verdict, so
  // it never loosens or tightens a failure state: we only advance the honest
  // terminal from the would-be PLAN_READY to AUTHORITY_NORMALIZED (we normalized
  // authority but have not DECIDED or PLANNED — those are G4/G5). If the evidence
  // gate already stopped in a failure state, authority is still recorded for
  // context, but the state stays fail-closed.
  const authority = input.authority ?? null
  if (authority) {
    if (state === "PLAN_READY") state = "AUTHORITY_NORMALIZED"
    const caps = authority.capabilities.length
    notes.push(
      caps === 0
        ? "authority normalized: no elevated capabilities detected"
        : `authority normalized: ${caps} capabilit${caps === 1 ? "y" : "ies"}${
            authority.approval.required.length > 0
              ? `, approvals required: ${authority.approval.required.join(", ")}`
              : ""
          }`,
    )
    if (authority.completeness === "partial") {
      notes.push("authority manifest is partial — some sources were not fully normalized")
    }
  }

  // G4 — Policy decision. Deterministic verdict over the manifest. Only advances
  // the honest terminal when authority was normalized (state AUTHORITY_NORMALIZED);
  // an earlier failure state stays fail-closed with the decision recorded for
  // context. The decision NEVER loosens a failure state — it can only refine the
  // AUTHORITY_NORMALIZED terminal into DECIDED (SAFE/REVIEW/BLOCK) or the
  // fail-closed POLICY_UNKNOWN (verdict UNKNOWN: insufficient evidence).
  const decision = input.decision ?? null
  if (decision) {
    if (state === "AUTHORITY_NORMALIZED") {
      state = decision.verdict === "UNKNOWN" ? "POLICY_UNKNOWN" : "DECIDED"
    }
    notes.push(
      `policy decision: ${decision.verdict}` +
        (decision.reasons.length > 0
          ? ` (${[...new Set(decision.reasons.map((r) => r.code))].join(", ")})`
          : ""),
    )
    if (decision.verdict === "UNKNOWN") {
      notes.push("verdict UNKNOWN — insufficient evidence; fail-closed, never a pass")
    }
  }

  return {
    schema: TRUST_PREPARATION_SCHEMA,
    artifact,
    evidence: input.evidence ? [...evidence] : null,
    authority,
    decision,
    plan: null,
    state,
    notes,
    preparedAt,
  }
}

/**
 * Exit code for `trust prepare`, mirroring the shipped `evidence import`
 * convention: 0 = clean/complete, 10 = review/partial, 20 = fail-closed
 * (degraded/blocked/unresolved/unknown).
 *
 * G4 contract: once a decision exists, the verdict drives the code —
 *   SAFE → 0 · REVIEW → 10 · BLOCK/UNKNOWN → 20.
 * Earlier terminals keep their own mapping (a partial-evidence stop is 10, a
 * failed-evidence or unresolved stop is 20) since they never reach a decision.
 */
export function prepareExitCode(prep: TrustPreparation): 0 | 10 | 20 {
  switch (prep.state) {
    case "PLAN_READY":
    case "AUTHORITY_NORMALIZED":
      // No decision reached (or evidence-only preparation) — clean read.
      return 0
    case "DECIDED":
      // Verdict drives the code: SAFE → 0, REVIEW → 10 (BLOCK never lands DECIDED).
      return prep.decision?.verdict === "REVIEW"
        ? 10
        : prep.decision?.verdict === "BLOCK"
          ? 20
          : 0
    case "FETCH_REJECTED":
    case "EVIDENCE_PARTIAL":
      return 10
    // RESOLUTION_FAILED · EVIDENCE_FAILED · POLICY_UNKNOWN → fail-closed
    default:
      return 20
  }
}
