/**
 * Cursor host adapter — Tier B (detect + analyze + plan only; NO apply).
 *
 * Cursor stores MCP servers under `mcpServers` in `.cursor/mcp.json` (project)
 * or the global Cursor config — the same shape Claude Code uses. This adapter
 * shapes the typed JSON-Patch that adds the resolved servers there. It ships at
 * **Tier B**: it declares NO `applyPlan`, so the type system (ADR 0037 §6)
 * forbids it from ever writing live config — `trust prepare --host cursor`
 * emits a reversible plan the user applies manually, and `trust apply` refuses a
 * Tier-B plan. Promotion to Tier A (adding `applyPlan`, which just delegates to
 * the audited host-agnostic engine) requires the ADR 0037 §6 gate: 20 positive +
 * 20 broken apply fixtures, Win/macOS/Linux E2E, and a measured <1% corruption
 * rate. Until then Cursor stays Tier B — the honest, safe intermediate state.
 *
 * Plan-building performs NO I/O and NEVER executes anything — the edge reads the
 * current config bytes/digest and passes them in via PlanContext.
 */
import type { InstallPlan } from "@calllint/types"
import type { HostAdapter, PlanContext, PlanUpstream, ValidationResult } from "../hostAdapter.js"
import { buildInstallPlan } from "../buildPlan.js"
import { validatePlan } from "../validate.js"

export const CURSOR_HOST_ID = "cursor" as const
const CURSOR_TIER = "B" as const

export const cursorAdapter: HostAdapter = {
  id: CURSOR_HOST_ID,
  tier: CURSOR_TIER,

  createPlan(ctx: PlanContext, upstream: PlanUpstream): InstallPlan {
    // The context already carries servers normalized to Cursor's known schema
    // (command/args/env or url). We only assemble the typed patch.
    return buildInstallPlan({ ...ctx, host: CURSOR_HOST_ID, tier: CURSOR_TIER }, upstream)
  },

  validatePlan(plan: InstallPlan): ValidationResult {
    return validatePlan(plan)
  },

  // No applyPlan: Tier B is plan-only. The user applies the emitted patch, or a
  // future Tier-A promotion adds `applyPlan` delegating to the audited engine.
}

/**
 * Reduce a resolver/parser NormalizedMcpServer to the exact entry Cursor stores
 * in `.cursor/mcp.json` — known fields only (ADR 0037 "known-schema writes
 * only"). Never a blind passthrough of `raw`. env is reconstructed from keys so
 * redacted values from a scan are never written as a live secret; the user fills
 * them at apply. Cursor uses the same `mcpServers` entry shape as Claude Code, so
 * this mirrors `claudeCodeServerEntry`.
 */
export function cursorServerEntry(server: {
  command?: string
  args?: string[]
  url?: string
  envKeys?: string[]
}): Record<string, unknown> {
  const entry: Record<string, unknown> = {}
  if (server.url) {
    entry["url"] = server.url
  } else if (server.command) {
    entry["command"] = server.command
    entry["args"] = server.args ?? []
  }
  if (server.envKeys && server.envKeys.length > 0) {
    // Keys only — values are supplied by the user, never carried from a scan.
    const env: Record<string, string> = {}
    for (const k of [...server.envKeys].sort()) env[k] = ""
    entry["env"] = env
  }
  return entry
}
