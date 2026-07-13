/**
 * Trust Gateway — read-only preparation (G1).
 *
 * Advances the read-only half of the state machine
 * (DISCOVERED → RESOLVED → FETCHED → … → PLAN_READY) over an already-resolved
 * Artifact Identity. PURE and DETERMINISTIC: no I/O, no wall clock — the CLI
 * edge resolves the artifact and injects `preparedAt`.
 *
 * G1 populates only the Artifact slot; Evidence/Authority/Decision/Plan are
 * null placeholders filled by G2/G3/G4/G5. A failure state never reads as a
 * pass, and an unresolved artifact never advances to PLAN_READY. See ADR 0035.
 */
import type {
  ArtifactIdentity,
  TrustPreparation,
  TrustPrepareState,
} from "@calllint/types"
import { TRUST_PREPARATION_SCHEMA } from "@calllint/types"

export interface PrepareInput {
  artifact: ArtifactIdentity
  /** ISO-8601 UTC, injected from the CLI edge. */
  preparedAt: string
}

/**
 * Build a read-only TrustPreparation from a resolved artifact.
 *
 * State logic (G1 scope):
 * - resolution "resolved"  → DISCOVERED→RESOLVED→FETCHED→PLAN_READY.
 * - resolution "partial"   → FETCH_REJECTED (we have some bytes but no immutable
 *                            pin, or a pin but no bytes; not a verified target).
 * - resolution "unresolved"→ RESOLUTION_FAILED (nothing to evaluate).
 *
 * Once G2–G5 land, PLAN_READY moves behind EVIDENCE_COLLECTED /
 * AUTHORITY_NORMALIZED / DECIDED; for G1 a resolved artifact with empty
 * downstream slots is already the read-only "plan preview".
 */
export function prepare(input: PrepareInput): TrustPreparation {
  const { artifact, preparedAt } = input
  const notes: string[] = []

  let state: TrustPrepareState
  switch (artifact.resolution) {
    case "resolved":
      state = "PLAN_READY"
      break
    case "partial":
      state = "FETCH_REJECTED"
      notes.push(
        "artifact could not be fully pinned (missing immutable ref or bytes); not a verified target"
      )
      break
    default:
      state = "RESOLUTION_FAILED"
      notes.push("artifact could not be resolved to an immutable, digested identity")
      break
  }

  for (const r of artifact.resolutionReasons ?? []) notes.push(r)

  return {
    schema: TRUST_PREPARATION_SCHEMA,
    artifact,
    evidence: null,
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
