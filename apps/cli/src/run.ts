import { parseArgs } from "./args.js"
import { helpCommand } from "./commands/help.js"
import { scanCommand, type CommandResult } from "./commands/scan.js"
import { checkCommand } from "./commands/check.js"
import { scanAllCommand } from "./commands/scanAll.js"
import { genRuleCommand } from "./commands/genRule.js"
import { diagnosticsCommand } from "./commands/diagnostics.js"
import { explainCommand } from "./commands/explain.js"
import { policyCommand } from "./commands/policy.js"
import { baselineCommand, verifyCommand } from "./commands/verify.js"
import { approveCommand } from "./commands/approve.js"
import { receiptCommand } from "./commands/receipt.js"
import { actionCommand } from "./commands/action.js"
import { inboxCommand } from "./commands/inbox.js"
import { inventoryCommand } from "./commands/inventory.js"
import { evidenceCommand } from "./commands/evidence.js"
import { trustCommand } from "./commands/trust.js"
import { guardCommand } from "./commands/guard.js"
import { integrateCommand } from "./commands/integrate.js"
import { emitCommandSignal } from "./telemetry.js"
import type { Emitter } from "@calllint/telemetry-emit"
import type { Finding } from "@calllint/types"

/**
 * Pre-fetched --online enrichment, computed by the async entry point before
 * the (synchronous) command runs. Keeps the network out of the pure pipeline.
 */
export interface OnlineEnrichment {
  /** Extra findings keyed by server name (npm registry facts). */
  extraFindings?: Record<string, Finding[]>
  /** Replaces input resolution (e.g. a github repo's fetched config). */
  inputOverride?: { text: string; configPath: string }
  /** A diagnostic line to surface (e.g. github fetch outcome). */
  note?: string
}

export interface RunDeps {
  cwd: string
  readStdin: () => string
  now: number
  generatedAt: string
  writeCacheFile?: boolean
  online?: OnlineEnrichment
  /** Returns newline-separated changed file paths for `scan --changed`. */
  getChangedFilesDiff?: () => string
  /** The CLI's own version, read at runtime for receipts (new5 R3). */
  toolVersion?: string
  /**
   * Optional telemetry emitter (new11 §3.5 / M1). When present, the central emit
   * site below reports each command's `telemetry` signal through it. Built gated-off
   * (local `cli` tier, no consent, noopSink) in `index.ts`, so it is a no-op in
   * production; tests inject a memory sink to assert the mapping. Absent ⇒ no emit.
   */
  emitter?: Emitter
}

/**
 * Dispatch a parsed argv to a command. Pure given deps — used directly in tests.
 *
 * Telemetry (new11 §3.5 / M1): after the command computes its result, its optional
 * `telemetry` signal is emitted through `deps.emitter` at ONE central site. With the
 * production emitter (gated-off, noopSink) this is a no-op and the returned result —
 * stdout/stderr/exitCode — is byte-identical. The `telemetry` field is stripped from
 * nothing and read by nobody else; it never reaches the process output.
 */
export function run(argv: string[], deps: RunDeps): CommandResult {
  const result = dispatch(argv, deps)
  emitCommandSignal(deps.emitter, result.telemetry, deps.toolVersion)
  return result
}

function dispatch(argv: string[], deps: RunDeps): CommandResult {
  const args = parseArgs(argv)
  const cmd = args.command

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    return helpCommand()
  }

  switch (cmd) {
    case "check":
      return checkCommand(args, {
        cwd: deps.cwd,
        readStdin: deps.readStdin,
        now: deps.now,
        generatedAt: deps.generatedAt,
      })
    case "scan-all":
      return scanAllCommand(args, {
        cwd: deps.cwd,
        now: deps.now,
        generatedAt: deps.generatedAt,
      })
    case "scan":
      return scanCommand(args, {
        cwd: deps.cwd,
        readStdin: deps.readStdin,
        now: deps.now,
        generatedAt: deps.generatedAt,
        writeCacheFile: deps.writeCacheFile,
        online: deps.online,
        getChangedFilesDiff: deps.getChangedFilesDiff,
        toolVersion: deps.toolVersion,
      })
    case "diagnostics":
      return diagnosticsCommand(args, {
        cwd: deps.cwd,
        readStdin: deps.readStdin,
        now: deps.now,
        generatedAt: deps.generatedAt,
        online: deps.online,
      })
    case "baseline":
      return baselineCommand(args, {
        cwd: deps.cwd,
        readStdin: deps.readStdin,
        generatedAt: deps.generatedAt,
        writeBaselineFile: deps.writeCacheFile,
        online: deps.online,
      })
    case "verify":
      return verifyCommand(args, {
        cwd: deps.cwd,
        readStdin: deps.readStdin,
        now: deps.now,
        generatedAt: deps.generatedAt,
        writeBaselineFile: deps.writeCacheFile,
        online: deps.online,
      })
    case "approve":
      return approveCommand(args, {
        cwd: deps.cwd,
        now: deps.now,
        generatedAt: deps.generatedAt,
        writeFile: deps.writeCacheFile,
      })
    case "explain":
      return explainCommand(args, { cwd: deps.cwd })
    case "receipt":
      return receiptCommand(args, { cwd: deps.cwd })
    case "action":
      return actionCommand(args, { cwd: deps.cwd, toolVersion: deps.toolVersion, generatedAt: deps.generatedAt })
    case "inbox":
      return inboxCommand(args, { cwd: deps.cwd, toolVersion: deps.toolVersion, generatedAt: deps.generatedAt })
    case "inventory":
      return inventoryCommand(args, { cwd: deps.cwd })
    case "evidence":
      return evidenceCommand(args, { cwd: deps.cwd })
    case "trust":
      return trustCommand(args, { cwd: deps.cwd, generatedAt: deps.generatedAt, toolVersion: deps.toolVersion })
    case "integrate":
      return integrateCommand(args, { cwd: deps.cwd, generatedAt: deps.generatedAt, toolVersion: deps.toolVersion })
    case "guard":
      return guardCommand(args, {
        cwd: deps.cwd,
        now: deps.now,
        generatedAt: deps.generatedAt,
        writeFile: deps.writeCacheFile,
      })
    case "gen-rule":
      return genRuleCommand(args, { cwd: deps.cwd })
    case "policy":
      return policyCommand(args, { cwd: deps.cwd })
    default:
      return {
        stdout: "",
        stderr: `Unknown command: ${cmd}\nRun \`calllint help\`.`,
        exitCode: 2,
      }
  }
}

export { type CommandResult } from "./commands/scan.js"
export { EXIT } from "./args.js"
