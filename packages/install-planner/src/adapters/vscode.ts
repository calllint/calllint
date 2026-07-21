/**
 * VS Code host adapter — Tier A (detect + analyze + plan + apply + rollback).
 *
 * VS Code stores MCP servers under `mcpServers` in a single user-level file
 * (`Code/User/mcp.json` — `%APPDATA%\` on Windows, `~/Library/Application Support/`
 * on macOS, `~/.config/` on Linux; see the discovery extractor). Its schema matches
 * Cursor / Claude Code (root-level `mcpServers` map), and a remote server is declared
 * with `url`. This adapter shapes the typed JSON-Patch that adds the resolved servers
 * and applies it by delegating to the audited host-agnostic engine (revalidate →
 * atomic write → verify → rollback). The adapter adds NO bespoke write logic; the
 * single dangerous surface stays in one audited place (ADR 0037).
 *
 * Plan-building performs NO I/O and NEVER executes anything (INV1) — the edge reads the
 * current config bytes/digest and passes them in via PlanContext.
 */
import type { InstallPlan, ApplyResult } from "@calllint/types"
import type { HostAdapter, PlanContext, PlanUpstream, ValidationResult, ApplyContext } from "../hostAdapter.js"
import { buildInstallPlan } from "../buildPlan.js"
import { validatePlan } from "../validate.js"
import { applyPlan as engineApply } from "../applyEngine.js"

export const VSCODE_HOST_ID = "vscode" as const
const VSCODE_TIER = "A" as const

export const vscodeAdapter: HostAdapter = {
  id: VSCODE_HOST_ID,
  tier: VSCODE_TIER,

  createPlan(ctx: PlanContext, upstream: PlanUpstream): InstallPlan {
    // The context already carries servers normalized to the known schema
    // (command/args/env or url). We only assemble the typed patch.
    return buildInstallPlan({ ...ctx, host: VSCODE_HOST_ID, tier: VSCODE_TIER }, upstream)
  },

  validatePlan(plan: InstallPlan): ValidationResult {
    return validatePlan(plan)
  },

  applyPlan(plan: InstallPlan, ctx: ApplyContext): ApplyResult {
    // Delegate to the audited, host-agnostic engine. VS Code's `mcp.json` is a plain
    // JSON object with an `mcpServers` map (same shape as Claude Code / Cursor), so the
    // engine's generic verify (re-parse + semantic match) is sufficient. The adapter
    // adds NO bespoke write logic; the single dangerous surface stays in one audited
    // place (ADR 0037). Tier A is earned by the real cross-OS apply E2E parametrized
    // over the Tier-A hosts (tests/e2e, ADR 0037 §6).
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
 * Reduce a resolver/parser NormalizedMcpServer to the exact entry VS Code stores in
 * `Code/User/mcp.json` — known fields only (ADR 0037 "known-schema writes only"). Never
 * a blind passthrough of `raw`. A remote server uses `url`; a stdio server uses
 * `command`/`args`. env is reconstructed from keys so redacted values from a scan are
 * never written as a live secret; the user fills them at apply.
 */
export function vscodeServerEntry(server: {
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
