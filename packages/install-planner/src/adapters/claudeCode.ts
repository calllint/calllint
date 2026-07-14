/**
 * Claude Code host adapter — Tier B in G5 (detect + analyze + plan ONLY).
 *
 * Claude Code stores MCP servers under `mcpServers` in its user config
 * (`~/.claude.json`). This adapter shapes the typed JSON-Patch that would add
 * the resolved servers there and the inverse rollback. It performs NO I/O and
 * NEVER executes anything — the edge reads the current config bytes/digest and
 * passes them in via PlanContext. It stays Tier B (the user applies the emitted
 * patch) until it clears G6's Tier-A E2E + <1% corruption kill gate (ADR 0037).
 */
import type { InstallPlan } from "@calllint/types"
import type { HostAdapter, PlanContext, PlanUpstream, ValidationResult } from "../hostAdapter.js"
import { buildInstallPlan } from "../buildPlan.js"
import { validatePlan } from "../validate.js"

export const CLAUDE_CODE_HOST_ID = "claude-code" as const

export const claudeCodeAdapter: HostAdapter = {
  id: CLAUDE_CODE_HOST_ID,
  tier: "B",

  createPlan(ctx: PlanContext, upstream: PlanUpstream): InstallPlan {
    // The context already carries servers normalized to Claude Code's known
    // schema (command/args/env or url). We only assemble the typed patch.
    return buildInstallPlan({ ...ctx, host: CLAUDE_CODE_HOST_ID, tier: "B" }, upstream)
  },

  validatePlan(plan: InstallPlan): ValidationResult {
    return validatePlan(plan)
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
