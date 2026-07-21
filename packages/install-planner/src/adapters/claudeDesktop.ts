/**
 * Claude Desktop host adapter — Tier A (detect + analyze + plan + apply + rollback).
 *
 * Claude Desktop stores MCP servers under `mcpServers` in a single user-level file
 * (`claude_desktop_config.json` — `%APPDATA%\Claude\` on Windows, `~/Library/
 * Application Support/Claude/` on macOS, `~/.config/Claude/` on Linux; see the
 * discovery extractor). That is the SAME root-`mcpServers` map shape Claude Code and
 * Cursor use, and a remote server is declared with `url` (like Claude Code, unlike
 * Windsurf's `serverUrl`). This adapter shapes the typed JSON-Patch that adds the
 * resolved servers and applies it by delegating to the audited host-agnostic engine
 * (revalidate → atomic write → verify → rollback). The adapter adds NO bespoke write
 * logic; the single dangerous surface stays in one audited place (ADR 0037).
 *
 * Plan-building performs NO I/O and NEVER executes anything (INV1) — the edge reads the
 * current config bytes/digest and passes them in via PlanContext.
 */
import type { InstallPlan, ApplyResult } from "@calllint/types"
import type { HostAdapter, PlanContext, PlanUpstream, ValidationResult, ApplyContext } from "../hostAdapter.js"
import { buildInstallPlan } from "../buildPlan.js"
import { validatePlan } from "../validate.js"
import { applyPlan as engineApply } from "../applyEngine.js"

export const CLAUDE_DESKTOP_HOST_ID = "claude-desktop" as const
const CLAUDE_DESKTOP_TIER = "A" as const

export const claudeDesktopAdapter: HostAdapter = {
  id: CLAUDE_DESKTOP_HOST_ID,
  tier: CLAUDE_DESKTOP_TIER,

  createPlan(ctx: PlanContext, upstream: PlanUpstream): InstallPlan {
    // The context already carries servers normalized to the known schema
    // (command/args/env or url). We only assemble the typed patch.
    return buildInstallPlan({ ...ctx, host: CLAUDE_DESKTOP_HOST_ID, tier: CLAUDE_DESKTOP_TIER }, upstream)
  },

  validatePlan(plan: InstallPlan): ValidationResult {
    return validatePlan(plan)
  },

  applyPlan(plan: InstallPlan, ctx: ApplyContext): ApplyResult {
    // Delegate to the audited, host-agnostic engine. Claude Desktop's config is a
    // plain JSON object with an `mcpServers` map (same shape as Claude Code / Cursor),
    // so the engine's generic verify (re-parse + semantic match) is sufficient. The
    // adapter adds NO bespoke write logic; the single dangerous surface stays in one
    // audited place (ADR 0037). Tier A is earned by the real cross-OS apply E2E
    // parametrized over the Tier-A hosts (tests/e2e, ADR 0037 §6).
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
 * Reduce a resolver/parser NormalizedMcpServer to the exact entry Claude Desktop stores
 * in `claude_desktop_config.json` — known fields only (ADR 0037 "known-schema writes
 * only"). Never a blind passthrough of `raw`. A remote server uses `url` (same as Claude
 * Code); a stdio server uses `command`/`args`. env is reconstructed from keys so redacted
 * values from a scan are never written as a live secret; the user fills them at apply.
 */
export function claudeDesktopServerEntry(server: {
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
