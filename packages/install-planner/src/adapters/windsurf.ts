/**
 * Windsurf host adapter — Tier A (detect + analyze + plan + apply + rollback).
 *
 * Windsurf (a Codeium product) stores MCP servers under `mcpServers` in a single
 * home-relative file, `~/.codeium/mcp_config.json` — the same map shape Claude
 * Code and Cursor use. This adapter shapes the typed JSON-Patch that adds the
 * resolved servers there and applies it by delegating to the audited
 * host-agnostic engine (revalidate → atomic write → verify → rollback). The
 * adapter adds NO bespoke write logic; the single dangerous surface stays in one
 * audited place (ADR 0037).
 *
 * The ONE shape difference from Cursor/Claude Code: a remote Windsurf server is
 * declared with `serverUrl` (the official Cascade MCP field), not `url`. That is
 * handled in `windsurfServerEntry` below; the plan/apply engine is unchanged.
 *
 * Plan-building performs NO I/O and NEVER executes anything — the edge reads the
 * current config bytes/digest and passes them in via PlanContext.
 */
import type { InstallPlan, ApplyResult } from "@calllint/types"
import type { HostAdapter, PlanContext, PlanUpstream, ValidationResult, ApplyContext } from "../hostAdapter.js"
import { buildInstallPlan } from "../buildPlan.js"
import { validatePlan } from "../validate.js"
import { applyPlan as engineApply } from "../applyEngine.js"

export const WINDSURF_HOST_ID = "windsurf" as const
const WINDSURF_TIER = "A" as const

export const windsurfAdapter: HostAdapter = {
  id: WINDSURF_HOST_ID,
  tier: WINDSURF_TIER,

  createPlan(ctx: PlanContext, upstream: PlanUpstream): InstallPlan {
    // The context already carries servers normalized to Windsurf's known schema
    // (command/args/env or serverUrl). We only assemble the typed patch.
    return buildInstallPlan({ ...ctx, host: WINDSURF_HOST_ID, tier: WINDSURF_TIER }, upstream)
  },

  validatePlan(plan: InstallPlan): ValidationResult {
    return validatePlan(plan)
  },

  applyPlan(plan: InstallPlan, ctx: ApplyContext): ApplyResult {
    // Delegate to the audited, host-agnostic engine — Windsurf's
    // `~/.codeium/mcp_config.json` is a plain JSON object with an `mcpServers`
    // map (same shape as Claude Code / Cursor), so the engine's generic verify
    // (re-parse + semantic match) is sufficient. The adapter adds NO bespoke
    // write logic; the single dangerous surface stays in one audited place
    // (ADR 0037). Tier A is earned by the real cross-OS apply E2E parametrized
    // over the Tier-A hosts (tests/e2e/test/apply-engine.e2e.test.ts, §6).
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
 * Reduce a resolver/parser NormalizedMcpServer to the exact entry Windsurf stores
 * in `~/.codeium/mcp_config.json` — known fields only (ADR 0037 "known-schema
 * writes only"). Never a blind passthrough of `raw`. env is reconstructed from
 * keys so redacted values from a scan are never written as a live secret; the
 * user fills them at apply.
 *
 * Unlike Cursor/Claude Code, a REMOTE server is written under `serverUrl` (the
 * official Windsurf Cascade field), not `url`. A stdio server uses the same
 * `command`/`args`/`env` shape.
 */
export function windsurfServerEntry(server: {
  command?: string
  args?: string[]
  url?: string
  envKeys?: string[]
}): Record<string, unknown> {
  const entry: Record<string, unknown> = {}
  if (server.url) {
    // Windsurf's remote-server field is `serverUrl`, not `url`.
    entry["serverUrl"] = server.url
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
