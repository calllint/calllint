import { decideRepoSurfaces, buildApproved, writeApproved, defaultApprovedPath } from "@calllint/core"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"

export interface ApproveDeps {
  cwd: string
  now: number
  generatedAt: string
  /** When false, skip writing the file (used in tests). */
  writeFile?: boolean
}

function approvedPathFor(args: ParsedArgs, cwd: string): string {
  return flagStr(args.flags, "approved") ?? defaultApprovedPath(cwd)
}

/**
 * `calllint approve` — record the current repo-wide capability surface as the
 * approved state (`.calllint/approved.json`, calllint.approved.v0). Offline,
 * static; never executes a scanned server. The L4 seed that `verify --approved`
 * diffs against.
 */
export function approveCommand(args: ParsedArgs, deps: ApproveDeps): CommandResult {
  const decisions = decideRepoSurfaces(deps.cwd, {
    now: deps.now,
    generatedAt: deps.generatedAt,
  })
  const state = buildApproved(decisions, deps.generatedAt)
  const path = approvedPathFor(args, deps.cwd)

  if (deps.writeFile !== false) {
    try {
      writeApproved(state, path)
    } catch (err) {
      return { stdout: "", stderr: `Could not write approved state: ${String(err)}`, exitCode: EXIT.ERROR }
    }
  }

  if (flagBool(args.flags, "json")) {
    return { stdout: JSON.stringify(state, null, 2), exitCode: EXIT.OK }
  }
  const n = state.approved.length
  return {
    stdout: `Approved ${n} surface${n === 1 ? "" : "s"} → ${path}`,
    exitCode: EXIT.OK,
  }
}
