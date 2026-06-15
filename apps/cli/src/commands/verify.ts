import { join } from "node:path"
import {
  scanConfigText,
  buildBaseline,
  computeDrift,
  writeBaseline,
  readBaseline,
  ConfigParseError,
} from "@mcpguard/core"
import { loadPolicyOrDefault } from "@mcpguard/policy"
import { renderDrift, renderDriftJson } from "@mcpguard/report-renderer"
import type { Policy } from "@mcpguard/types"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"
import { resolveConfigInput, isInputError } from "./resolveInput.js"
import type { OnlineEnrichment } from "../run.js"

export interface VerifyDeps {
  cwd: string
  readStdin: () => string
  generatedAt: string
  /** When false, skip writing the baseline file (used in tests). */
  writeBaselineFile?: boolean
  online?: OnlineEnrichment
}

function loadPolicy(args: ParsedArgs): Policy | { error: string } {
  try {
    return loadPolicyOrDefault(flagStr(args.flags, "policy"))
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function baselinePathFor(args: ParsedArgs, cwd: string): string {
  return flagStr(args.flags, "baseline") ?? join(cwd, ".mcpguard", "baseline.json")
}

/** `mcpguard baseline` — scan and record the approved risk surface. */
export function baselineCommand(args: ParsedArgs, deps: VerifyDeps): CommandResult {
  const policy = loadPolicy(args)
  if ("error" in policy) return { stdout: "", stderr: policy.error, exitCode: EXIT.ERROR }

  const input = deps.online?.inputOverride ?? resolveConfigInput(args, deps)
  if (isInputError(input)) return { stdout: "", stderr: input.error, exitCode: input.exitCode }

  let summary
  try {
    summary = scanConfigText(input.text, input.configPath, {
      policy,
      generatedAt: deps.generatedAt,
      extraFindings: deps.online?.extraFindings,
    })
  } catch (err) {
    if (err instanceof ConfigParseError) {
      return { stdout: "", stderr: `Parse error in ${input.configPath}: ${err.message}`, exitCode: EXIT.ERROR }
    }
    throw err
  }

  const baseline = buildBaseline(summary, deps.generatedAt)
  const path = baselinePathFor(args, deps.cwd)
  if (deps.writeBaselineFile !== false) {
    try {
      writeBaseline(baseline, path)
    } catch (err) {
      return { stdout: "", stderr: `Could not write baseline: ${String(err)}`, exitCode: EXIT.ERROR }
    }
  }

  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(baseline, null, 2), exitCode: EXIT.OK }
  }
  const n = baseline.entries.length
  return {
    stdout: `Baseline written for ${n} server${n === 1 ? "" : "s"} → ${path}`,
    exitCode: EXIT.OK,
  }
}

/** `mcpguard verify` — scan and compare against the recorded baseline. */
export function verifyCommand(args: ParsedArgs, deps: VerifyDeps): CommandResult {
  const policy = loadPolicy(args)
  if ("error" in policy) return { stdout: "", stderr: policy.error, exitCode: EXIT.ERROR }

  const path = baselinePathFor(args, deps.cwd)
  const baseline = readBaseline(path)
  if (!baseline) {
    return {
      stdout: "",
      stderr: `No baseline found at ${path}. Run \`mcpguard baseline\` first.`,
      exitCode: EXIT.ERROR,
    }
  }

  const input = deps.online?.inputOverride ?? resolveConfigInput(args, deps)
  if (isInputError(input)) return { stdout: "", stderr: input.error, exitCode: input.exitCode }

  let summary
  try {
    summary = scanConfigText(input.text, input.configPath, {
      policy,
      generatedAt: deps.generatedAt,
      extraFindings: deps.online?.extraFindings,
    })
  } catch (err) {
    if (err instanceof ConfigParseError) {
      return { stdout: "", stderr: `Parse error in ${input.configPath}: ${err.message}`, exitCode: EXIT.ERROR }
    }
    throw err
  }

  const drift = computeDrift(baseline, summary, deps.generatedAt)

  const stdout = flagBool(args.flags, "json")
    ? renderDriftJson(drift)
    : renderDrift(drift)

  // Exit code only under --ci: drift fails the process.
  const exitCode =
    flagBool(args.flags, "ci") && drift.drifted ? EXIT.DRIFT : EXIT.OK
  return { stdout, exitCode }
}
