/**
 * Trust Gateway — read-only preparation (G1 + G2).
 *
 * Advances the read-only half of the state machine
 * (DISCOVERED → RESOLVED → FETCHED → EVIDENCE_COLLECTED → … → PLAN_READY) over
 * an already-resolved Artifact Identity plus any attached evidence. PURE and
 * DETERMINISTIC: no I/O, no wall clock — the CLI edge resolves the artifact,
 * imports evidence from files, and injects `preparedAt`.
 *
 * G1 populated only the Artifact slot. G2 wires the shipped Evidence Envelope in:
 * evidence is provenance-preserved and NEVER re-scored. It can only TIGHTEN the
 * preparation (degraded/failed evidence lowers the state), never loosen it — a
 * failed external scan never reads as a pass (ADR 0034 / 0035).
 *
 * Authority/Decision/Plan are still null placeholders (G3/G4/G5).
 */
import type {
  ArtifactIdentity,
  GatewayEvidence,
  TrustPreparation,
  TrustPrepareState,
} from "@calllint/types"
import { TRUST_PREPARATION_SCHEMA } from "@calllint/types"

export interface PrepareInput {
  artifact: ArtifactIdentity
  /** Attached external evidence (already imported at the edge; never re-scored). */
  evidence?: GatewayEvidence[]
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

  return {
    schema: TRUST_PREPARATION_SCHEMA,
    artifact,
    evidence: input.evidence ? [...evidence] : null,
    authority: null,
    decision: null,
    plan: null,
    state,
    notes,
    preparedAt,
  }
}

/**
 * Exit code for `trust prepare`, mirroring the shipped `evidence import`
 * convention: 0 = clean/complete, 10 = review/partial, 20 = fail-closed
 * (degraded/blocked/unresolved). Refined in G4 once a real decision exists.
 */
export function prepareExitCode(prep: TrustPreparation): 0 | 10 | 20 {
  switch (prep.state) {
    case "PLAN_READY":
      return 0
    case "FETCH_REJECTED":
    case "EVIDENCE_PARTIAL":
      return 10
    default:
      return 20
  }
}
