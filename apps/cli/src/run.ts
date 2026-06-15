import { parseArgs } from "./args.js"
import { helpCommand } from "./commands/help.js"
import { scanCommand, type CommandResult } from "./commands/scan.js"
import { explainCommand } from "./commands/explain.js"
import { policyCommand } from "./commands/policy.js"
import { baselineCommand, verifyCommand } from "./commands/verify.js"

export interface RunDeps {
  cwd: string
  readStdin: () => string
  now: number
  generatedAt: string
  writeCacheFile?: boolean
}

/** Dispatch a parsed argv to a command. Pure given deps — used directly in tests. */
export function run(argv: string[], deps: RunDeps): CommandResult {
  const args = parseArgs(argv)
  const cmd = args.command

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    return helpCommand()
  }

  switch (cmd) {
    case "scan":
      return scanCommand(args, {
        cwd: deps.cwd,
        readStdin: deps.readStdin,
        now: deps.now,
        generatedAt: deps.generatedAt,
        writeCacheFile: deps.writeCacheFile,
      })
    case "baseline":
      return baselineCommand(args, {
        cwd: deps.cwd,
        readStdin: deps.readStdin,
        generatedAt: deps.generatedAt,
        writeBaselineFile: deps.writeCacheFile,
      })
    case "verify":
      return verifyCommand(args, {
        cwd: deps.cwd,
        readStdin: deps.readStdin,
        generatedAt: deps.generatedAt,
        writeBaselineFile: deps.writeCacheFile,
      })
    case "explain":
      return explainCommand(args, { cwd: deps.cwd })
    case "policy":
      return policyCommand(args, { cwd: deps.cwd })
    default:
      return {
        stdout: "",
        stderr: `Unknown command: ${cmd}\nRun \`mcpguard help\`.`,
        exitCode: 2,
      }
  }
}

export { type CommandResult } from "./commands/scan.js"
export { EXIT } from "./args.js"
