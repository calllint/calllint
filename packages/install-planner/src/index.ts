/**
 * @calllint/install-planner — the Trust Gateway's plan layer (G5, ADR 0036/0037).
 *
 * Standalone stable I/O contract (Plan in / ApplyResult out), CLI-independent,
 * and isolated from analysis so plan generation NEVER triggers detection logic.
 * G5 ships the plan-only half (pure assembly + Tier-B Claude Code adapter). The
 * only writer, `trust apply`, arrives in G6.
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
