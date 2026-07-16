/**
 * @calllint/install-planner — the Trust Gateway's plan + apply layer
 * (G5 plan-only, G6 apply; ADR 0036/0037).
 *
 * Standalone stable I/O contract (Plan in / ApplyResult out), CLI-independent,
 * and isolated from analysis so plan generation NEVER triggers detection logic.
 * G5 shipped the plan-only half (pure assembly + Tier-B Claude Code adapter).
 * G6 adds the ONLY writer — the apply engine (revalidate → atomic write → verify
 * → rollback) behind an injectable FS port, and promotes Claude Code to Tier A.
 */
export type {
  HostAdapter,
  HostDetection,
  PlanContext,
  PlanUpstream,
  PlannedServer,
  ValidationResult,
} from "./hostAdapter.js"
export { buildInstallPlan, buildServerOps, verifyPlanDigest } from "./buildPlan.js"
export { validatePlan } from "./validate.js"
export { applyJsonPatch, JsonPatchError } from "./jsonPatch.js"
export { applyPlan, type ApplyOptions } from "./applyEngine.js"
// Re-export the gateway data types this package operates over, so consumers can
// import them from the gateway package rather than reaching into @calllint/types.
export type { InstallPlan, InstallOperation, JsonPatchOp, ApplyResult, ApplyOutcome } from "@calllint/types"
export type { ConfigFs } from "./fsPort.js"
export { nodeFsPort } from "./nodeFsPort.js"
export { safeConfigPath, expandHome, PathSafetyError } from "./pathSafety.js"
// G7 — decision receipt (calllint.receipt.v1) + gateway drift taxonomy (ADR 0039)
export {
  buildDecisionReceipt,
  signDecisionReceipt,
  receiptBodyDigest,
  type ReceiptContext,
} from "./decisionReceipt.js"
export { verifyDecisionReceipt, type VerifyDecisionResult } from "./verifyDecisionReceipt.js"
export { classifyReceiptDrift } from "./receiptDrift.js"
export type {
  DecisionReceipt,
  ReceiptApproval,
  ReceiptResult,
  DriftClass,
  DriftSignal,
  DriftChange,
  ReceiptDriftInput,
  ReceiptDriftReport,
} from "@calllint/types"
export {
  claudeCodeAdapter,
  claudeCodeServerEntry,
  CLAUDE_CODE_HOST_ID,
} from "./adapters/claudeCode.js"
export {
  cursorAdapter,
  cursorServerEntry,
  CURSOR_HOST_ID,
} from "./adapters/cursor.js"

import { claudeCodeAdapter } from "./adapters/claudeCode.js"
import { cursorAdapter } from "./adapters/cursor.js"
import type { HostAdapter } from "./hostAdapter.js"

/** Registry of known host adapters, keyed by id. */
export const HOST_ADAPTERS: Record<string, HostAdapter> = {
  [claudeCodeAdapter.id]: claudeCodeAdapter,
  [cursorAdapter.id]: cursorAdapter,
}

/** Look up an adapter by host id; null if unknown. */
export function getHostAdapter(host: string): HostAdapter | null {
  return HOST_ADAPTERS[host] ?? null
}
