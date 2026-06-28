import {
  checkParsed,
  loadSurfaceText,
  parseSnippet,
  ConfigParseError,
} from "@calllint/core"
import {
  renderDecision,
  renderExplain,
  NO_EMOJI_STYLE,
  DEFAULT_STYLE,
} from "@calllint/report-renderer"
import type { Verdict } from "@calllint/types"
import { EXIT, flagBool, type ParsedArgs } from "../args.js"
import { resolveConfigInput, isInputError } from "./resolveInput.js"
import type { CommandResult } from "./scan.js"

export interface CheckDeps {
  cwd: string
  readStdin: () => string
  now: number
  generatedAt: string
}

/**
 * `calllint check [path|npm:pkg|-]` — the new4 primary verb. Emits a COMPACT
 * decision by default (≤30 lines): verdict + reason codes + next action.
 * `--json` emits the compact decision as JSON (<1 KB for one surface).
 * `--explain` / `--full` defer to the rich Evidence-layer renderers (L3).
 *
 * Default path is offline, no-LLM, and never executes the scanned server.
 */
export function checkCommand(args: ParsedArgs, deps: CheckDeps): CommandResult {
  const style = flagBool(args.flags, "no-emoji") ? NO_EMOJI_STYLE : DEFAULT_STYLE
  const opts = { now: deps.now, generatedAt: deps.generatedAt }

  // Resolve the surface: stdin snippet, explicit path, npm:/github: target, or
  // default discovery — reusing the shared resolver so behavior matches `scan`.
  const input = resolveConfigInput(args, deps)
  if (isInputError(input)) {
    return { stdout: "", stderr: input.error, exitCode: input.exitCode }
  }

  let decisions
  try {
    // A raw snippet handed via --stdin that is not JSON: treat as an install
    // snippet (npx/uvx/claude mcp add ...). Otherwise parse as a config.
    const looksLikeJson = input.text.trim().startsWith("{")
    if (input.configPath === "<stdin>" && !looksLikeJson) {
      const { parsed } = parseSnippet(input.text)
      decisions = checkParsed(parsed, "stdin:snippet", "remote", opts)
    } else {
      const loaded = loadSurfaceText(input.text, input.configPath)
      decisions = checkParsed(loaded.parsed, input.configPath, loaded.origin, opts)
    }
  } catch (e) {
    if (e instanceof ConfigParseError) {
      return { stdout: "", stderr: `Parse error: ${e.message}`, exitCode: EXIT.ERROR }
    }
    if (e instanceof Error) {
      // Unrecognized snippet etc. — UNKNOWN, never SAFE.
      return { stdout: "", stderr: e.message, exitCode: EXIT.UNKNOWN }
    }
    throw e
  }

  if (decisions.length === 0) {
    // Nothing examined → UNKNOWN (ADR 0010: SAFE requires an examined source).
    return {
      stdout: "UNKNOWN  no agent-tool capability found in input",
      exitCode: EXIT.UNKNOWN,
    }
  }

  // --explain / --full → Evidence layer (rich report), one per server.
  if (flagBool(args.flags, "explain") || flagBool(args.flags, "full")) {
    const stdout = decisions
      .map((d) => renderExplain(d.report, style))
      .join("\n\n")
    return { stdout, exitCode: worstExit(decisions) }
  }

  // --json → compact decisions as JSON (default machine output).
  if (flagBool(args.flags, "json")) {
    const payload =
      decisions.length === 1
        ? decisions[0]!.decision
        : decisions.map((d) => d.decision)
    return { stdout: JSON.stringify(payload), exitCode: worstExit(decisions) }
  }

  // Default: compact human+agent view.
  const stdout = decisions.map((d) => renderDecision(d.decision, style)).join("\n\n")
  return { stdout, exitCode: worstExit(decisions) }
}

/** Worst (highest) exit code across all surface decisions. */
function worstExit(decisions: { decision: { verdict: Verdict } }[]): number {
  let worst: number = EXIT.OK
  for (const d of decisions) {
    const code = exitForVerdict(d.decision.verdict)
    if (code > worst) worst = code
  }
  return worst
}

/**
 * Verdict → exit code for the compact path. Unlike `scan`, `check` has no policy
 * loaded, so it always signals on non-SAFE (the agent/CI decides what to do).
 */
function exitForVerdict(verdict: Verdict): number {
  switch (verdict) {
    case "BLOCK":
      return EXIT.BLOCK
    case "UNKNOWN":
      return EXIT.UNKNOWN
    case "REVIEW":
      return EXIT.REVIEW
    case "SAFE":
      return EXIT.OK
  }
}
