/**
 * Phase 2.5-A — the self-claim production-dogfood core (new13 §Phase-2.5-A; ADR 0055 §7,
 * the hard-block spine). PURE: no clock, no fs, no network.
 *
 * It drives CallLint's OWN real claim record through the full lifecycle —
 * ACTIVATE → REVOKE → REACTIVATE — using the SHIPPED `reconcileClaims` core verbatim
 * (ADR 0048 §4). No reconciliation logic is re-implemented here; this module only
 * *sequences* the shipped reconciler across the three installation states and hands the
 * three resulting stores back for the caller to bake and diff.
 *
 * WHY this exists when `bake-claim.test.ts` already proves the overlay never moves a page
 * digest: that test proves it for a SYNTHETIC fixture across TWO states (active vs. empty).
 * Phase 2.5-A raises the bar to CallLint's OWN namespace in PRODUCTION coordinates across
 * the FULL three-leg lifecycle, because the loop must provably close on our own namespace
 * before any external claim surface is built (new13 Round 2). The load-bearing property is
 * unchanged (ADR 0047 §1 / 0053 §3): a maintainer claim states namespace CONTROL, never
 * safety — it may appear, be revoked, and reappear WITHOUT ever moving the observed verdict
 * or the page digest.
 *
 * The three legs mirror the three real-world installation states of the CallLint GitHub App
 * (ID 4322539) on the `calllint` account:
 *   • ACTIVATE   — the App IS installed and covers `calllint/calllint`  → one active record
 *   • REVOKE     — the App is uninstalled (no installation observed)     → record → revoked
 *   • REACTIVATE — the App is re-installed                              → a fresh active record
 * REVOKE and REACTIVATE are driven in the real world by a HUMAN GitHub-UI App uninstall/
 * re-install — the one action the ingestion plane cannot self-trigger. This module models
 * the reconciliation deterministically so the immutability property is machine-provable
 * OFFLINE, around that human action. The production ledger that records the real legs as the
 * human performs them lives in `artifacts/phase-2.5-self-claim/` (see its README).
 *
 * This module changes NO schema and NO serving byte; it is orchestration over shipped code.
 */
import { reconcileClaims, type InstallationView } from "./reconcileClaims.js"
import { EMPTY_CLAIM_STORE, type ClaimStore } from "./claim.js"

/**
 * CallLint's own self-claim coordinates — the single in-code source for the dogfood and the
 * human runbook. These MIRROR the committed claim store (`claims/claim-store.json`) and the
 * committed registry snapshot; `audit-self-claim-readiness.mjs` cross-checks them against the
 * committed store at runtime, so a drift (e.g. a re-installed App minting a new installation
 * id) is reported rather than silently trusted. `appId` is used ONLY by the human runbook —
 * the reconciler keys off the installation grant, never the app id.
 */
export const SELF_CLAIM = {
  /** The CallLint GitHub App's numeric id (ADR 0048 §1). Runbook-only; not a reconciler input. */
  appId: 4322539,
  /** The durable, revocable installation grant on the `calllint` account (claim-store.json). */
  installationId: 147742681,
  /** The public GitHub account that controls the namespace. */
  account: "calllint",
  /** The repository whose ownership proves control (github.com/calllint/calllint). */
  repo: { owner: "calllint", name: "calllint" },
  /** The canonical Trust-Index name CallLint's own page is baked under. */
  canonicalName: "mcp-registry/io.github.calllint-calllint",
} as const

/** The live installation view when the App IS installed and covers `calllint/calllint`. */
export function selfInstallationView(): InstallationView {
  return {
    installationId: SELF_CLAIM.installationId,
    account: SELF_CLAIM.account,
    repos: [{ owner: SELF_CLAIM.repo.owner, name: SELF_CLAIM.repo.name }],
  }
}

/** The three observation instants for the three legs (ISO-8601 UTC; injected, never clocked). */
export interface LifecycleTimestamps {
  activate: string
  revoke: string
  reactivate: string
}

/** The three reconciled stores, one per lifecycle leg. */
export interface SelfClaimLifecycleResult {
  /** App installed → CallLint's namespace has exactly one active record. */
  activate: ClaimStore
  /** App uninstalled (not observed) → the record flips to `revoked` (fails closed). */
  revoke: ClaimStore
  /** App re-installed → a fresh active record; the revoked one is kept as an audit trail. */
  reactivate: ClaimStore
}

/**
 * Drive CallLint's own claim through ACTIVATE → REVOKE → REACTIVATE using the SHIPPED
 * `reconcileClaims` (PURE). Each leg feeds the previous leg's store back in, exactly as the
 * Actions verify job would across three real runs:
 *   1. previous = empty, App observed        → reconcile → one active record
 *   2. previous = leg 1, App NOT observed     → reconcile → record flipped to revoked
 *   3. previous = leg 2, App observed again   → reconcile → fresh active record (+ audit trail)
 *
 * `repoIndex` and `bakedDigests` come from the committed snapshot + baked index (the caller
 * reads them); a claim is only minted for a namespace whose page is actually baked
 * (`reconcileClaims` skips an unbaked page). Deterministic given its inputs.
 */
export function reconcileSelfClaimLifecycle(input: {
  repoIndex: Map<string, string>
  bakedDigests: Map<string, `sha256:${string}`>
  timestamps: LifecycleTimestamps
}): SelfClaimLifecycleResult {
  const { repoIndex, bakedDigests, timestamps } = input
  const view = selfInstallationView()

  const activate = reconcileClaims({
    previous: EMPTY_CLAIM_STORE,
    installations: [view],
    repoIndex,
    bakedDigests,
    now: timestamps.activate,
  })
  const revoke = reconcileClaims({
    previous: activate,
    installations: [], // App uninstalled — no installation observed this run.
    repoIndex,
    bakedDigests,
    now: timestamps.revoke,
  })
  const reactivate = reconcileClaims({
    previous: revoke,
    installations: [view], // App re-installed.
    repoIndex,
    bakedDigests,
    now: timestamps.reactivate,
  })
  return { activate, revoke, reactivate }
}

/** Count the currently-active records for CallLint's own namespace in a store (serving count). */
export function activeSelfClaimCount(store: ClaimStore): number {
  return store.records.filter(
    (r) => r.canonicalName === SELF_CLAIM.canonicalName && r.status === "active",
  ).length
}
