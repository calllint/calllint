import { join } from "node:path"
import {
  scanConfigText,
  buildBaseline,
  computeDrift,
  writeBaseline,
  readBaseline,
  decideRepoSurfaces,
  readApproved,
  verifyApproved,
  defaultApprovedPath,
  ConfigParseError,
} from "@calllint/core"
import { loadPolicyOrDefault } from "@calllint/policy"
import {
  renderDrift,
  renderDriftJson,
  renderApprovedDrift,
  renderApprovedDriftJson,
} from "@calllint/report-renderer"
import type { Policy } from "@calllint/types"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"
import { resolveConfigInput, isInputError } from "./resolveInput.js"
import type { OnlineEnrichment } from "../run.js"

export interface VerifyDeps {
  cwd: string
  readStdin: () => string
  generatedAt: string
  /** Injected clock for the surface walker (approved mode). */
  now?: number
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
  return flagStr(args.flags, "baseline") ?? join(cwd, ".calllint", "baseline.json")
}

/** `calllint baseline` — scan and record the approved risk surface. */
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

/** `calllint verify` — scan and compare against the recorded baseline. */
export function verifyCommand(args: ParsedArgs, deps: VerifyDeps): CommandResult {
  // Capability-layer approved-state mode (ADR 0024). Opt-in via --approved.
  if (flagBool(args.flags, "approved")) {
    return verifyApprovedMode(args, deps)
  }

  const policy = loadPolicy(args)
  if ("error" in policy) return { stdout: "", stderr: policy.error, exitCode: EXIT.ERROR }

  const path = baselinePathFor(args, deps.cwd)
  const baseline = readBaseline(path)
  if (!baseline) {
    return {
      stdout: "",
      stderr: `No baseline found at ${path}. Run \`calllint baseline\` first.`,
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

function approvedPathFor(args: ParsedArgs, cwd: string): string {
  const flag = flagStr(args.flags, "approved")
  // --approved may be a bare boolean (use default path) or carry a path.
  return typeof flag === "string" && flag.length > 0
    ? flag
    : defaultApprovedPath(cwd)
}

/**
 * `calllint verify --approved` — recompute the repo-wide capability surface and
 * diff against `.calllint/approved.json` (ADR 0024). Offline, static; never
 * executes a scanned server. Drift never collapses to SAFE.
 */
function verifyApprovedMode(args: ParsedArgs, deps: VerifyDeps): CommandResult {
  const path = approvedPathFor(args, deps.cwd)
  const approved = readApproved(path)
  if (!approved) {
    return {
      stdout: "",
      stderr: `No approved state found at ${path}. Run \`calllint approve\` first.`,
      exitCode: EXIT.ERROR,
    }
  }

  const current = decideRepoSurfaces(deps.cwd, {
    now: deps.now ?? (Date.parse(deps.generatedAt) || 0),
    generatedAt: deps.generatedAt,
  })

  const drift = verifyApproved(current, approved, deps.generatedAt)

  const stdout = flagBool(args.flags, "json")
    ? renderApprovedDriftJson(drift)
    : renderApprovedDrift(drift)

  const exitCode =
    flagBool(args.flags, "ci") && drift.drifted ? EXIT.DRIFT : EXIT.OK
  return { stdout, exitCode }
}
