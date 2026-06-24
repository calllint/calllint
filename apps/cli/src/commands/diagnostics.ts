import {
  scanConfigText,
  ConfigParseError,
} from "@calllint/core"
import { loadPolicyOrDefault } from "@calllint/policy"
import { renderDiagnostics } from "@calllint/report-renderer"
import type { Policy } from "@calllint/types"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import { exitCodeFor } from "../exitCode.js"
import { resolveConfigInput, isInputError } from "./resolveInput.js"
import type { CommandResult } from "./scan.js"
import type { OnlineEnrichment } from "../run.js"

export interface DiagnosticsDeps {
  cwd: string
  readStdin: () => string
  now: number
  generatedAt: string
  online?: OnlineEnrichment
}

/**
 * `calllint diagnostics [--json] <target>` — emit the diagnostics protocol
 * (calllint.diagnostics.v0), an editor / agent-host projection of the scan
 * (ADR 0013). It runs the same pipeline as `scan`, then renders diagnostics
 * instead of a ScanReport; it changes no verdict and adds no analysis. v0 emits
 * JSON only.
 */
export function diagnosticsCommand(
  args: ParsedArgs,
  deps: DiagnosticsDeps,
): CommandResult {
  if (!flagBool(args.flags, "json")) {
    return {
      stdout: "",
      stderr:
        "diagnostics v0 emits JSON only — pass --json (calllint.diagnostics.v0).",
      exitCode: EXIT.USAGE,
    }
  }

  let policy: Policy
  try {
    policy = loadPolicyOrDefault(flagStr(args.flags, "policy"))
  } catch (err) {
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: EXIT.ERROR,
    }
  }

  const input = deps.online?.inputOverride ?? resolveConfigInput(args, deps)
  if (isInputError(input)) {
    return { stdout: "", stderr: input.error, exitCode: input.exitCode }
  }
  const { text, configPath } = input

  let summary
  try {
    summary = scanConfigText(text, configPath, {
      policy,
      now: deps.now,
      generatedAt: deps.generatedAt,
      extraFindings: deps.online?.extraFindings,
    })
  } catch (err) {
    if (err instanceof ConfigParseError) {
      return {
        stdout: "",
        stderr: `Parse error in ${configPath}: ${err.message}`,
        exitCode: EXIT.ERROR,
      }
    }
    throw err
  }

  const stdout = renderDiagnostics(summary)
  // Exit code mirrors scan: only fail the process under --ci.
  const exitCode = flagBool(args.flags, "ci")
    ? exitCodeFor(summary, policy)
    : EXIT.OK
  return { stdout, exitCode }
}
