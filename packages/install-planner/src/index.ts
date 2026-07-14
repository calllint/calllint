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
export type { ConfigFs } from "./fsPort.js"
export { nodeFsPort } from "./nodeFsPort.js"
export { safeConfigPath, expandHome, PathSafetyError } from "./pathSafety.js"
export {
  claudeCodeAdapter,
  claudeCodeServerEntry,
  CLAUDE_CODE_HOST_ID,
} from "./adapters/claudeCode.js"

import { claudeCodeAdapter } from "./adapters/claudeCode.js"
import type { HostAdapter } from "./hostAdapter.js"

/** Registry of known host adapters, keyed by id. */
export const HOST_ADAPTERS: Record<string, HostAdapter> = {
  [claudeCodeAdapter.id]: claudeCodeAdapter,
}

/** Look up an adapter by host id; null if unknown. */
export function getHostAdapter(host: string): HostAdapter | null {
  return HOST_ADAPTERS[host] ?? null
}
