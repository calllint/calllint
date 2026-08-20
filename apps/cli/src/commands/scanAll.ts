import { decideRepoSurfaces } from "@calllint/core"
import type { CompactDecision } from "@calllint/types"
import {
  renderDecisionTable,
  NO_EMOJI_STYLE,
  DEFAULT_STYLE,
} from "@calllint/report-renderer"
import { EXIT, flagBool, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"
import type { TelemetrySignal } from "../telemetry.js"

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

  // One signal per decided surface. `scan-all` reported NOTHING before: it never set a
  // `telemetry` field at all, so the command that touches the most configs was the one
  // command invisible to usage measurement. Derived from `decisions` (which already carry
  // a verdict) rather than from the scan path, so no extra work is done when telemetry is
  // off — the emitter is gated and simply discards these.
  //
  // `Verdict` and `TelemetryResult` are the same four-label vocabulary ("SAFE" | "REVIEW"
  // | "BLOCK" | "UNKNOWN"), so this needs no cast and a divergence would fail typecheck
  // rather than silently emitting an off-contract result.
  // Two signals per surface, matching the single-config `scan` path: that a preflight ran,
  // and what it decided. `flatMap` so N surfaces yield 2N signals in decision order.
  const telemetry: TelemetrySignal[] = decisions.flatMap((d) => [
    { event: "preflight_completed" } as TelemetrySignal,
    { verdict: d.verdict } as TelemetrySignal,
  ])

  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(decisions), exitCode: worstExit(decisions), telemetry }
  }

  return {
    stdout: renderDecisionTable(decisions, style),
    exitCode: worstExit(decisions),
    telemetry,
  }
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
