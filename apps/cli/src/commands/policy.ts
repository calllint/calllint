import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { defaultPolicyJson, loadPolicyOrDefault } from "@mcpguard/policy"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import type { CommandResult } from "./scan.js"

export interface PolicyDeps {
  cwd: string
}

/** `policy init` and `policy explain`. */
export function policyCommand(args: ParsedArgs, deps: PolicyDeps): CommandResult {
  const sub = args.positionals[0]

  if (sub === "init") {
    const path = join(deps.cwd, "mcpguard.policy.json")
    if (existsSync(path) && !flagBool(args.flags, "force")) {
      return {
        stdout: "",
        stderr: `${path} already exists. Use --force to overwrite.`,
        exitCode: EXIT.USAGE,
      }
    }
    writeFileSync(path, defaultPolicyJson(), "utf8")
    return { stdout: `Wrote default policy to ${path}`, exitCode: EXIT.OK }
  }

  if (sub === "explain") {
    try {
      const policy = loadPolicyOrDefault(flagStr(args.flags, "policy"))
      return { stdout: JSON.stringify(policy, null, 2), exitCode: EXIT.OK }
    } catch (err) {
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: EXIT.ERROR,
      }
    }
  }

  return {
    stdout: "",
    stderr: "Usage: mcpguard policy <init|explain>",
    exitCode: EXIT.USAGE,
  }
}
