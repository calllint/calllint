/**
 * `calllint.safe-install-result.v1` — the machine-readable OUTCOME envelope of the
 * safe-install orchestrator (new14 Phase 2.4 Batch 5; ADR 0056 §9).
 *
 * PURE + deterministic: types + total mapping functions, no I/O and no clock. The
 * orchestrator (safeInstall.ts) owns the flow; this module owns only the shape and
 * the state→outcome projection, so the closed `outcome` vocabulary can never drift.
 *
 * INVARIANTS enforced here:
 *   - The result carries NO verdict of its own (INV-2.4-01). It projects the
 *     shipped Trust Gateway's terminal state; a BLOCK stays BLOCK, an UNKNOWN
 *     stays fail-closed, and nothing here can upgrade either.
 *   - There is no runtime ajv anywhere in the repo — schemas are enforced by TS
 *     types + string compare, and JSON-schema validation runs ONLY in tests
 *     (safeInstall.schema.test.ts compiles this schema and asserts every emitted
 *     envelope validates). So `emitSafeInstallResult` returns a plain typed object.
 *   - `outcome` is the closed 7-value enum from the SHIPPED schema
 *     (schemas/calllint.safe-install-result.v1.schema.json), which is authoritative
 *     over the execution-plan §10.9 prose (reality wins).
 *   - ONE_TIME_PROTECTED_SETUP MUST leave zero persistent CallLint components
 *     (INV-2.4-07); `persistentComponents` is [] and asserted. CONTINUOUS_PROTECTION
 *     is Batch 8 — never emitted here.
 */
import type { ApplyResult, TrustPreparation } from "@calllint/types"
import { EXIT } from "../../args.js"

export type Sha256 = `sha256:${string}`

/** The wire tag — the contract is the tag, not the filename (ADR 0043/0055 §5). */
export const SAFE_INSTALL_RESULT_SCHEMA = "calllint.safe-install-result.v1" as const

/**
 * Closed outcome vocabulary (SHIPPED schema `outcome` enum — authoritative):
 *   PREPARED               a valid, reversible plan was computed; NOT applied.
 *   APPLIED_AND_VERIFIED   the shipped writer applied the plan and the receipt verified.
 *   BLOCKED                the deterministic verdict is BLOCK — no applyable plan.
 *   LOCAL_PREFLIGHT_REQUIRED  identity/verdict could not be confirmed for an exact,
 *                             actionable local install (UNKNOWN / unresolved / no exact
 *                             version), OR a delegated apply did not durably hold
 *                             (conflict / stale / rolled back) → fail-closed, re-preflight.
 *   UNSUPPORTED            no supported Tier-A host adapter for an actionable install.
 *   ABORTED_ON_MISMATCH    an exact-target identity assertion failed → no writable plan.
 *   DECLINED               the operator did not approve at the single approval gate.
 */
export type SafeInstallOutcome =
  | "PREPARED"
  | "APPLIED_AND_VERIFIED"
  | "BLOCKED"
  | "LOCAL_PREFLIGHT_REQUIRED"
  | "UNSUPPORTED"
  | "ABORTED_ON_MISMATCH"
  | "DECLINED"

export type SafeInstallMode = "ONE_TIME_PROTECTED_SETUP" | "CONTINUOUS_PROTECTION"

/** The emitted envelope. Every known key is present (null / [] where empty) so the
 *  serialization is complete and deterministic; `additionalProperties:false` in the
 *  schema forbids anything beyond these. */
export interface SafeInstallResultV1 {
  readonly schema: typeof SAFE_INSTALL_RESULT_SCHEMA
  readonly outcome: SafeInstallOutcome
  readonly canonicalName: string
  readonly mode: SafeInstallMode
  readonly host: string | null
  readonly version: string | null
  readonly artifactDigest: Sha256 | null
  readonly contractDigest: Sha256 | null
  readonly planDigest: Sha256 | null
  readonly receiptDigest: Sha256 | null
  readonly persistentComponents: readonly string[]
  readonly notes: readonly string[]
}

export interface EmitSafeInstallResultParams {
  outcome: SafeInstallOutcome
  canonicalName: string
  /** Batch 5 is one-time only; defaults to ONE_TIME_PROTECTED_SETUP. */
  mode?: SafeInstallMode
  host?: string | null
  version?: string | null
  artifactDigest?: Sha256 | null
  contractDigest?: Sha256 | null
  planDigest?: Sha256 | null
  receiptDigest?: Sha256 | null
  /** MUST be empty in ONE_TIME_PROTECTED_SETUP (INV-2.4-07); asserted below. */
  persistentComponents?: readonly string[]
  notes?: readonly string[]
}

/**
 * Build a `calllint.safe-install-result.v1` envelope. Pure. Fails closed if a
 * one-time-mode result is asked to carry persistent components — that would be a
 * silent INV-2.4-07 violation, so it throws rather than emit a false-clean record.
 */
export function emitSafeInstallResult(params: EmitSafeInstallResultParams): SafeInstallResultV1 {
  const mode: SafeInstallMode = params.mode ?? "ONE_TIME_PROTECTED_SETUP"
  const persistentComponents = params.persistentComponents ?? []
  if (mode === "ONE_TIME_PROTECTED_SETUP" && persistentComponents.length > 0) {
    throw new Error(
      "INV-2.4-07: ONE_TIME_PROTECTED_SETUP must install zero persistent CallLint components",
    )
  }
  return {
    schema: SAFE_INSTALL_RESULT_SCHEMA,
    outcome: params.outcome,
    canonicalName: params.canonicalName,
    mode,
    host: params.host ?? null,
    version: params.version ?? null,
    artifactDigest: params.artifactDigest ?? null,
    contractDigest: params.contractDigest ?? null,
    planDigest: params.planDigest ?? null,
    receiptDigest: params.receiptDigest ?? null,
    persistentComponents: [...persistentComponents],
    notes: [...(params.notes ?? [])],
  }
}

/**
 * Project a prepare-only TrustPreparation terminal state onto the result outcome.
 * Total over the REAL `TrustPrepareState` values (prepare.ts) — NOT the
 * placeholder names an earlier draft used. Keyed off BOTH state and verdict,
 * because a BLOCK verdict still reaches PLAN_READY with an (inert) BLOCK plan
 * (prepare.ts computes a plan for any confident verdict), so state alone cannot
 * distinguish PREPARED from BLOCKED.
 *
 * This is the "prepared, not applied" branch. UNSUPPORTED / DECLINED /
 * APPLIED_AND_VERIFIED are decided at the flow level by the orchestrator, never here.
 */
export function mapPrepareToOutcome(prep: TrustPreparation): SafeInstallOutcome {
  const verdict = prep.decision?.verdict
  switch (prep.state) {
    case "TARGET_MISMATCH":
      return "ABORTED_ON_MISMATCH"
    case "PLAN_READY":
    case "DECIDED":
      // A confident verdict was reached. BLOCK never applies; UNKNOWN never lands
      // here with an active plan, but map it fail-closed if it somehow does.
      if (verdict === "BLOCK") return "BLOCKED"
      if (verdict === "UNKNOWN") return "LOCAL_PREFLIGHT_REQUIRED"
      return "PREPARED" // SAFE / REVIEW (or a bare resolved read)
    case "POLICY_UNKNOWN":
      // Verdict UNKNOWN — insufficient evidence; fail-closed, never SAFE.
      return "LOCAL_PREFLIGHT_REQUIRED"
    case "RESOLUTION_FAILED":
    case "FETCH_REJECTED":
    case "EVIDENCE_PARTIAL":
    case "EVIDENCE_FAILED":
    case "AUTHORITY_NORMALIZED":
    default:
      // Could not pin/decide an exact actionable target → re-run local pre-flight.
      return "LOCAL_PREFLIGHT_REQUIRED"
  }
}

/**
 * Project a delegated apply outcome onto the result outcome. APPLIED_AND_VERIFIED
 * requires BOTH a durable apply (`applied` / idempotent `already_applied`) AND a
 * structurally-valid decision receipt. Every other apply outcome
 * (stale / conflict / rolled_back / rollback_failed, or a receipt that failed to
 * verify) is fail-closed: nothing durable can be claimed, so the result degrades
 * to LOCAL_PREFLIGHT_REQUIRED and the human/notes carry the ApplyResult detail.
 * The closed 7-value enum has no dedicated apply-failure member (reality wins over
 * §10.9's APPLY_FAILED/VERIFICATION_FAILED prose), so a fail-closed bucket is used.
 */
export function mapAppliedToOutcome(result: ApplyResult, receiptValid: boolean): SafeInstallOutcome {
  const durable = result.outcome === "applied" || result.outcome === "already_applied"
  return durable && receiptValid ? "APPLIED_AND_VERIFIED" : "LOCAL_PREFLIGHT_REQUIRED"
}

/**
 * Exit code for an outcome, reusing the shipped stable EXIT map (args.ts). Clean
 * terminals are 0 (APPLIED_AND_VERIFIED, PREPARED, DECLINED — a cancel is not a
 * failure); BLOCK is 30; every fail-closed terminal (mismatch / preflight /
 * unsupported) is 20. Usage errors are handled by the orchestrator (EXIT.USAGE).
 */
export function outcomeExitCode(outcome: SafeInstallOutcome): number {
  switch (outcome) {
    case "APPLIED_AND_VERIFIED":
    case "PREPARED":
    case "DECLINED":
      return EXIT.OK
    case "BLOCKED":
      return EXIT.BLOCK
    case "ABORTED_ON_MISMATCH":
    case "LOCAL_PREFLIGHT_REQUIRED":
    case "UNSUPPORTED":
      return EXIT.UNKNOWN
  }
}
