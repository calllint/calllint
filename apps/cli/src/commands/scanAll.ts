import { decideRepoSurfaces } from "@calllint/core"
import type { CompactDecision } from "@calllint/types"
import {
  renderDecisionTable,
  NO_EMOJI_STYLE,
  DEFAULT_STYLE,
} from "@calllint/report-renderer"
import { EXIT, flagBool, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"

export interface ScanAllDeps {
  cwd: string
  now: number
  generatedAt: string
}

/**
 * `calllint scan-all` — find every agent-tool surface in the repo and emit a
 * compact decision table. Ignores node_modules and other build/vendor dirs.
 * Offline, no-LLM, never executes a scanned server.
 */
export function scanAllCommand(args: ParsedArgs, deps: ScanAllDeps): CommandResult {
  const style = flagBool(args.flags, "no-emoji") ? NO_EMOJI_STYLE : DEFAULT_STYLE

  const decisions = decideRepoSurfaces(deps.cwd, {
    now: deps.now,
    generatedAt: deps.generatedAt,
  })

  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(decisions), exitCode: worstExit(decisions) }
  }

  return { stdout: renderDecisionTable(decisions, style), exitCode: worstExit(decisions) }
}

export function worstExit(decisions: readonly CompactDecision[]): number {
  let worst: number = EXIT.OK
  for (const d of decisions) {
    const code =
      d.verdict === "BLOCK"
        ? EXIT.BLOCK
        : d.verdict === "UNKNOWN"
          ? EXIT.UNKNOWN
          : d.verdict === "REVIEW"
            ? EXIT.REVIEW
            : EXIT.OK
    if (code > worst) worst = code
  }
  return worst
}
