/**
 * Cursor host adapter — Tier A (detect + analyze + plan + apply + rollback).
 *
 * Cursor stores MCP servers under `mcpServers` in `.cursor/mcp.json` (project)
 * or the global Cursor config — the same shape Claude Code uses. This adapter
 * shapes the typed JSON-Patch that adds the resolved servers there, and applies
 * it by delegating to the audited host-agnostic engine (revalidate → atomic
 * write → verify → rollback). It shipped first at Tier B (plan-only) and was
 * promoted to **Tier A** once the ADR 0037 §6 gate was met by the real cross-OS
 * apply E2E (20 positive + 20 broken/conflict on ubuntu/macOS/windows, measured
 * <1% corruption — `tests/e2e/test/apply-engine.e2e.test.ts`). The adapter adds
 * NO bespoke write logic; the single dangerous surface stays in one audited place.
 *
 * Plan-building performs NO I/O and NEVER executes anything — the edge reads the
 * current config bytes/digest and passes them in via PlanContext.
 */
import type { InstallPlan, ApplyResult } from "@calllint/types"
import type { HostAdapter, PlanContext, PlanUpstream, ValidationResult, ApplyContext } from "../hostAdapter.js"
import { buildInstallPlan } from "../buildPlan.js"
import { validatePlan } from "../validate.js"
import { applyPlan as engineApply } from "../applyEngine.js"

export const CURSOR_HOST_ID = "cursor" as const
const CURSOR_TIER = "A" as const

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

  applyPlan(plan: InstallPlan, ctx: ApplyContext): ApplyResult {
    // Delegate to the audited, host-agnostic engine — Cursor's `.cursor/mcp.json`
    // is a plain JSON object with an `mcpServers` map (same shape as Claude Code),
    // so the engine's generic verify (re-parse + semantic match) is sufficient.
    // The adapter adds NO bespoke write logic; the single dangerous surface stays
    // in one audited place (ADR 0037). Promoted to Tier A on the strength of the
    // real cross-OS apply E2E (tests/e2e/test/apply-engine.e2e.test.ts, ADR 0037 §6).
    return engineApply({
      plan,
      approvalDigest: ctx.approvalDigest,
      configPath: ctx.configPath,
      backupPath: ctx.backupPath,
      lockPath: ctx.lockPath,
      fs: ctx.fs,
      now: ctx.now,
    })
  },
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
