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

/** States of the read-only half. Apply-side states arrive with G6. */
export type TrustPrepareState =
  | "DISCOVERED"
  | "RESOLVED"
  | "FETCHED"
  | "EVIDENCE_COLLECTED"
  | "AUTHORITY_NORMALIZED"
  | "DECIDED"
  | "PLAN_READY"
  // failure states (each terminal; none implies success)
  | "RESOLUTION_FAILED"
  | "FETCH_REJECTED"
  | "EVIDENCE_PARTIAL"
  | "EVIDENCE_FAILED"
  | "POLICY_UNKNOWN"

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
  authority: unknown | null
  /** Object 4 — Policy Decision; filled by G4. */
  decision: unknown | null
  /** Object 5 — Install Plan; filled by G5. */
  plan: unknown | null
  /** Where the read-only state machine stopped. */
  state: TrustPrepareState
  /** Human-readable notes about degradation / why a slot is empty. */
  notes: string[]
  /** ISO-8601 UTC, injected from the CLI edge. */
  preparedAt: string
}

export const TRUST_PREPARATION_SCHEMA = "calllint.trust-preparation.v0" as const
