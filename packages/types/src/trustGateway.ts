/**
 * Trust Gateway — the read-only preparation object produced by `trust prepare`.
 *
 * This is the assembled preview of the six data objects, produced by the
 * READ-ONLY half of the gateway state machine (DISCOVERED → PLAN_READY). It
 * writes no live config. Downstream Phase-G steps fill in the currently-stub
 * slots: G2 evidence, G3 authority, G4 decision, G5 plan.
 *
 * See ADR 0035 / 0036 and docs/new8-packet-g-trust-gateway.md.
 */
import type { ArtifactIdentity } from "./artifact.js"
import type { AuthorityManifest } from "./authority.js"
import type { TrustDecision } from "./trustDecision.js"
import type { InstallPlan } from "./installPlan.js"

/**
 * Minimal shape of an evidence envelope as the gateway sees it. The full type
 * lives in @calllint/evidence (calllint.evidence-provider.v0); the gateway only
 * needs its completeness + provenance to advance the read-only state machine and
 * never re-scores it.
 */
export interface GatewayEvidence {
  schema_version: "calllint.evidence-provider.v0"
  provider: string
  providerVersion: string
  completeness: "complete" | "partial" | "degraded" | "failed"
  scanMode: "static" | "llm" | "deep"
  findings: unknown[]
  degradedReasons: string[]
  rawReportDigest: `sha256:${string}`
}

/**
 * Full gateway state machine (ADR 0036 §G.3). The read-only half runs
 * DISCOVERED → PLAN_READY inside `trust prepare`; the apply half
 * (AWAITING_APPROVAL → … → MONITORED) runs inside `trust apply` (G6). Every
 * failure state is terminal and NONE falls through to APPLIED.
 */
export type TrustPrepareState =
  | "DISCOVERED"
  | "RESOLVED"
  | "FETCHED"
  | "EVIDENCE_COLLECTED"
  | "AUTHORITY_NORMALIZED"
  | "DECIDED"
  | "PLAN_READY"
  // apply half (G6) — reached only by `trust apply` over an approved plan
  | "AWAITING_APPROVAL"
  | "REVALIDATING"
  | "APPLIED"
  | "VERIFIED"
  | "MONITORED"
  // failure states (each terminal; none implies success)
  | "RESOLUTION_FAILED"
  | "FETCH_REJECTED"
  | "EVIDENCE_PARTIAL"
  | "EVIDENCE_FAILED"
  | "POLICY_UNKNOWN"
  | "PLAN_STALE"
  | "APPLY_CONFLICT"
  | "ROLLBACK_REQUIRED"
  | "VERIFICATION_FAILED"

/**
 * The result of a read-only `trust prepare`. `state` names where the state
 * machine stopped; a failure state never reads as a pass. Slots that a later
 * Phase-G step fills are typed `unknown | null` here and are `null` until then.
 */
export interface TrustPreparation {
  schema: "calllint.trust-preparation.v0"
  /** Object 1 — always present (may be unresolved). */
  artifact: ArtifactIdentity
  /** Object 2 — Evidence Envelope(s), provenance-preserved; filled by G2. */
  evidence: GatewayEvidence[] | null
  /** Object 3 — Authority Manifest; filled by G3. */
  authority: AuthorityManifest | null
  /** Object 4 — Policy Decision; filled by G4. */
  decision: TrustDecision | null
  /** Object 5 — Install Plan; filled by G5 (host-gated; null when no host in play). */
  plan: InstallPlan | null
  /** Where the read-only state machine stopped. */
  state: TrustPrepareState
  /** Human-readable notes about degradation / why a slot is empty. */
  notes: string[]
  /** ISO-8601 UTC, injected from the CLI edge. */
  preparedAt: string
}

export const TRUST_PREPARATION_SCHEMA = "calllint.trust-preparation.v0" as const
