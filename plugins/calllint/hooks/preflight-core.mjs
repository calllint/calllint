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
 * The non-blocking preflight recommendations, mirrored from
 * `@calllint/agent-triggers` `RECOMMENDATIONS` (ADR 0051 §4). The plugin ships
 * dependency-free plain `.mjs`, so it cannot import that package at runtime; this
 * copy is pinned identical to the source by the invariant test (one vocabulary,
 * no second vocabulary — the same discipline as the single shared lexical ranker).
 * There is deliberately NO "deny"/"block" member: the hook never enforces.
 */
export const RECOMMENDATIONS = ["proceed", "review", "gather-evidence", "stop-and-confirm"]

/**
 * Capture an agent-tool install action and name the exact SHIPPED Trust-Gateway
 * route that re-adjudicates it — WITHOUT running, scanning, or deciding anything
 * here (ADR 0055 §4; ADR 0051/0052 floor).
 *
 * This is a pure data projection: given the config surface being written, it
 * returns the human-approved prepare → review → apply path verbatim. It never
 * grants authority and never writes host config — the ONLY writer is the
 * human-approved `calllint trust apply` (apps/cli `applyPlan`), which the hook
 * never reaches. Absence of a prior verdict is `gather-evidence`, never SAFE.
 */
export function installCapture(filePath) {
  const name = basename(filePath)
  return {
    // No verdict is computed here, so the honest state is exactly UNKNOWN's:
    // re-adjudicate before relying on the tool. Mirrors recommendFromVerdict(null).
    recommendation: "gather-evidence",
    // The shipped, human-in-the-loop Trust-Gateway route (apps/cli `trust`).
    // prepare is READ-ONLY (builds a reviewable plan, executes nothing); the
    // human then approves the exact plan digest; apply is the ONLY writer.
    reAdjudicate: [
      `calllint trust prepare ${name} --host <id>`,
      `calllint trust apply --plan <plan-file> --approve <plan-digest>`,
    ],
    // The apply step emits this decision receipt when asked (`--receipt <file>`).
    receiptSchema: "calllint.receipt.v1",
    // Structural ADR 0051 guarantee, surfaced for downstream assertion.
    blocking: false,
  }
}

/**
 * Build the non-blocking PreToolUse recommendation payload for a config path.
 * `systemMessage` is user-facing; `additionalContext` is for Claude. Neither
 * gates the call, and there is deliberately no `permissionDecision` field
 * (ADR 0051 — the hook never denies).
 */
export function recommendation(filePath) {
  const name = basename(filePath)
  const capture = installCapture(filePath)
  const line = `CallLint: "${name}" grants agent-tool authority. Before relying on it, preflight the blast radius: \`npx -y calllint scan ${name}\` (or \`calllint integrate\` to install the preflight). SAFE / REVIEW / BLOCK / UNKNOWN, with evidence — UNKNOWN is never SAFE. This is advice, not a block; CallLint never executes the server it judges.`
  return {
    systemMessage: line,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        `The file being edited (${filePath}) is an agent-tool configuration surface. ` +
        `Recommend running CallLint as a preflight before treating the tool as trusted: ` +
        `\`calllint scan ${name}\` for a config, or the secure-agent-install workflow for a new server/skill. ` +
        // Capture the install action and name the shipped Trust-Gateway route that
        // re-adjudicates it. This is guidance the agent may follow, not a gate: the
        // prepare step executes nothing, the human approves the exact plan digest,
        // and `trust apply` (the only writer) runs only on that human approval.
        `To re-adjudicate the install itself before it is trusted, use the human-in-the-loop ` +
        `Trust Gateway: \`${capture.reAdjudicate[0]}\` (read-only; builds a reviewable plan, executes nothing), ` +
        `review it, then \`${capture.reAdjudicate[1]}\` (the only step that writes host config, and only on your approval; ` +
        `optionally \`--receipt <file>\` writes a ${capture.receiptSchema} decision receipt). ` +
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
