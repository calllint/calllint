/**
 * Claude Code host adapter — Tier A (detect + analyze + plan + apply + rollback).
 *
 * Claude Code stores MCP servers under `mcpServers` in its user config
 * (`~/.claude.json`). This adapter shapes the typed JSON-Patch that adds the
 * resolved servers there and the inverse rollback. Plan-building performs NO I/O
 * and NEVER executes anything — the edge reads the current config bytes/digest
 * and passes them in via PlanContext. Apply (G6) delegates to the host-agnostic
 * apply engine over the edge-supplied FS port (revalidate → atomic write →
 * verify → rollback); the adapter adds no bespoke write logic, so the single
 * dangerous surface stays in one audited place (ADR 0037).
 */
import type { InstallPlan, ApplyResult } from "@calllint/types"
import type { HostAdapter, PlanContext, PlanUpstream, ValidationResult, ApplyContext } from "../hostAdapter.js"
import { buildInstallPlan } from "../buildPlan.js"
import { validatePlan } from "../validate.js"
import { applyPlan as engineApply } from "../applyEngine.js"

export const CLAUDE_CODE_HOST_ID = "claude-code" as const
const CLAUDE_CODE_TIER = "A" as const

export const claudeCodeAdapter: HostAdapter = {
  id: CLAUDE_CODE_HOST_ID,
  tier: CLAUDE_CODE_TIER,

  createPlan(ctx: PlanContext, upstream: PlanUpstream): InstallPlan {
    // The context already carries servers normalized to Claude Code's known
    // schema (command/args/env or url). We only assemble the typed patch.
    return buildInstallPlan({ ...ctx, host: CLAUDE_CODE_HOST_ID, tier: CLAUDE_CODE_TIER }, upstream)
  },

  validatePlan(plan: InstallPlan): ValidationResult {
    return validatePlan(plan)
  },

  applyPlan(plan: InstallPlan, ctx: ApplyContext): ApplyResult {
    // Delegate to the audited, host-agnostic engine. Claude Code's config is a
    // plain JSON object with an `mcpServers` map, so the engine's generic verify
    // (re-parse + semantic match against the computed post-config) is sufficient.
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
 * Reduce a resolver/parser NormalizedMcpServer to the exact entry Claude Code
 * stores — known fields only (ADR 0037 "known-schema writes only"). Never a
 * blind passthrough of `raw`. env is reconstructed from keys so redacted values
 * from a scan are never written as a live secret; the user fills them at apply.
 */
export function claudeCodeServerEntry(server: {
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
