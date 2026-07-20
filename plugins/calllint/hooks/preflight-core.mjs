/**
 * Pure logic for the CallLint preflight hook (new11 P2, PR-12).
 *
 * Split out from `preflight.mjs` so it is unit-testable with no stdin/process.
 * Bound by ADR 0051: these functions only CLASSIFY a path and BUILD a
 * non-blocking recommendation. They never scan, execute, or decide a verdict.
 */

import { basename } from "node:path"

/** Config filenames/patterns that grant agent-tool authority (worth a preflight). */
export const CONFIG_PATTERNS = [
  /(^|[/\\])\.mcp\.json$/i,
  /(^|[/\\])mcp\.json$/i, // .cursor/mcp.json, .vscode/mcp.json
  /(^|[/\\])mcp_config\.json$/i, // windsurf ~/.codeium/mcp_config.json
  /(^|[/\\])claude_desktop_config\.json$/i,
  /(^|[/\\])\.claude\.json$/i,
  /(^|[/\\])\.claude([/\\]).*settings\.json$/i, // .claude/settings.json
  /(^|[/\\])settings\.json$/i, // gated below: only under a .claude dir
  /(^|[/\\])SKILL\.md$/i,
]

/** True if this path is an agent-tool config surface worth a preflight. */
export function isConfigSurface(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return false
  const name = basename(filePath)
  // A bare settings.json is too broad to flag on name alone; require the .claude
  // dir so we do not nag on every settings.json in a repo.
  if (/^settings\.json$/i.test(name) && !/[/\\]\.claude[/\\]/i.test(filePath)) {
    return false
  }
  return CONFIG_PATTERNS.some((re) => re.test(filePath))
}

/** The tool_input target path across Write/Edit/MultiEdit shapes; null if none. */
export function targetPathOf(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return null
  const fp = toolInput.file_path ?? toolInput.filePath ?? toolInput.path
  return typeof fp === "string" ? fp : null
}

/**
 * Build the non-blocking PreToolUse recommendation payload for a config path.
 * `systemMessage` is user-facing; `additionalContext` is for Claude. Neither
 * gates the call, and there is deliberately no `permissionDecision` field
 * (ADR 0051 — the hook never denies).
 */
export function recommendation(filePath) {
  const name = basename(filePath)
  const line = `CallLint: "${name}" grants agent-tool authority. Before relying on it, preflight the blast radius: \`npx -y calllint scan ${name}\` (or \`calllint integrate\` to install the preflight). SAFE / REVIEW / BLOCK / UNKNOWN, with evidence — UNKNOWN is never SAFE. This is advice, not a block; CallLint never executes the server it judges.`
  return {
    systemMessage: line,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        `The file being edited (${filePath}) is an agent-tool configuration surface. ` +
        `Recommend running CallLint as a preflight before treating the tool as trusted: ` +
        `\`calllint scan ${name}\` for a config, or the secure-agent-install workflow for a new server/skill. ` +
        `Do not treat UNKNOWN as SAFE. This recommendation does not block the edit.`,
    },
  }
}

/**
 * Given a parsed PreToolUse event, return the recommendation payload to print,
 * or null when the tool is not touching a config surface (hook stays silent).
 * This is the whole decision the hook makes — pure and total.
 */
export function preflightFor(event) {
  const filePath = targetPathOf(event?.tool_input)
  if (filePath && isConfigSurface(filePath)) return recommendation(filePath)
  return null
}
