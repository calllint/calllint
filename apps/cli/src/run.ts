import { EXIT, parseArgs } from "./args.js"
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
import { safeInstallCommand } from "./commands/safeInstall.js"
import type { ResolvedContract } from "./commands/safeInstall/contractFetch.js"
import { guardCommand } from "./commands/guard.js"
import { integrateCommand } from "./commands/integrate.js"
import { urlHandlerCommand, type UrlHandlerDeps } from "./commands/urlHandler.js"
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
  /**
   * Writes an interactive prompt BEFORE `readStdin` blocks (R-2b). Only the
   * safe-install approval gate uses it; absent ⇒ interactive `--apply` is refused
   * rather than collecting an approval for a plan the human was never shown.
   */
  promptOut?: (text: string) => void
  /** True when stdin is a real terminal. Absent ⇒ false (fail closed). */
  stdinIsTty?: boolean
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
   * site below reports each command's `telemetry` signal through it. `index.ts` builds
   * it with a `queueSink()` and consent read from the state file — NOT the `noopSink`
   * this comment used to claim — so it is a no-op only because the local `cli` tier
   * fails closed without an explicit `telemetry enable`. Tests inject a memory sink to
   * assert the mapping. Absent ⇒ no emit. See src/telemetry.ts for the released-vs-HEAD
   * distinction: no published build carries the sink at all.
   */
  emitter?: Emitter
  /**
   * The adoption contract for `safe-install`, already acquired + wire-shape-checked
   * at the async CLI edge (computeContractFetch, mirroring `online`). Absent for
   * every other command, so their paths stay network-free and byte-identical.
   */
  contract?: ResolvedContract
  /**
   * Workstream R — the OS-facing deps for `url-handler`. Injected so no test ever
   * touches a real registry or a real home directory, and so the platform branch is
   * exercisable on every CI OS. Absent ⇒ `url-handler` reports its dependency is
   * unavailable rather than silently guessing the machine.
   */
  urlHandler?: UrlHandlerDeps
}

/**
 * Dispatch a parsed argv to a command. Pure given deps — used directly in tests.
 *
 * Telemetry (new11 §3.5 / M1): after the command computes its result, its optional
 * `telemetry` signal is emitted through `deps.emitter` at ONE central site. The
 * production emitter is gated-off by CONSENT (not by a `noopSink`, which is what this
 * comment used to say), so with telemetry disabled this is a no-op and the returned
 * result — stdout/stderr/exitCode — is byte-identical. That byte-identity is the
 * invariant, and it holds whether the sink is noop, queue-backed, or enabled. The
 * `telemetry` field is stripped from nothing and read by nobody else; it never reaches
 * the process output.
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
    case "safe-install":
      return safeInstallCommand(args, {
        cwd: deps.cwd,
        generatedAt: deps.generatedAt,
        toolVersion: deps.toolVersion,
        readStdin: deps.readStdin,
        promptOut: deps.promptOut,
        stdinIsTty: deps.stdinIsTty,
        contract: deps.contract,
      })
    case "integrate":
      return integrateCommand(args, { cwd: deps.cwd, generatedAt: deps.generatedAt, toolVersion: deps.toolVersion })
    case "url-handler":
      // No silent fallback to a real machine: without the injected port this command
      // has no business guessing, so it refuses.
      if (!deps.urlHandler) {
        return {
          stdout: "",
          stderr: "Error: url-handler is unavailable in this context (no OS registry port)\n",
          exitCode: EXIT.USAGE,
        }
      }
      return urlHandlerCommand(args, deps.urlHandler)
    case "guard":
      return guardCommand(args, {
        cwd: deps.cwd,
        now: deps.now,
        generatedAt: deps.generatedAt,
        writeFile: deps.writeCacheFile,
      })
    // Phase 2.4 Batch 8 — `calllint protect` is a pure ALIAS for `guard install`
    // (the discoverable name the continuous-protection offer can point at). It is
    // an argv rewrite, not a second implementation: one writer, one host matrix,
    // one posture rule (INV-2.4-03). `protect --host x` == `guard install --host x`.
    case "protect":
      return guardCommand(
        { ...args, positionals: ["install", ...args.positionals] },
        {
          cwd: deps.cwd,
          now: deps.now,
          generatedAt: deps.generatedAt,
          writeFile: deps.writeCacheFile,
        },
      )
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
