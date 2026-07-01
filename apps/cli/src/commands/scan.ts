import { join, resolve } from "node:path"
import {
  scanConfigText,
  writeCache,
  createReceipt,
  ConfigParseError,
} from "@calllint/core"
import { loadPolicyOrDefault } from "@calllint/policy"
import {
  renderJson,
  renderTerminal,
  renderCompact,
  renderSarif,
  renderMarkdown,
  renderBadge,
  renderHtml,
  NO_EMOJI_STYLE,
  DEFAULT_STYLE,
} from "@calllint/report-renderer"
import type { Policy } from "@calllint/types"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import { exitCodeFor } from "../exitCode.js"
import { resolveConfigInput, isInputError } from "./resolveInput.js"
import { changedConfigPaths } from "./changedConfigs.js"
import { readDocumentSurfaces } from "./surfaces.js"
import type { OnlineEnrichment } from "../run.js"
import { readFileSync, writeFileSync } from "node:fs"
import type { ConfigSummaryReport } from "@calllint/types"

export interface CommandResult {
  stdout: string
  stderr?: string
  exitCode: number
}

export interface ScanDeps {
  cwd: string
  readStdin: () => string
  now: number
  generatedAt: string
  /** When false, skip writing the cache (used in tests). */
  writeCacheFile?: boolean
  online?: OnlineEnrichment
  /**
   * Returns newline-separated changed file paths (e.g. `git diff --name-only
   * HEAD`).  Used only by `--changed`; injected so the command stays pure.
   */
  getChangedFilesDiff?: () => string
  /**
   * The running CLI version, injected at the entry boundary (see version.ts).
   * Only used to stamp `tool.version` on a receipt (`--receipt`). Optional so
   * existing tests that don't exercise receipts need not provide it.
   */
  toolVersion?: string
}

export function scanCommand(args: ParsedArgs, deps: ScanDeps): CommandResult {
  // `--changed` scans only the agent-tool configs that appear in the git diff.
  // It is the git-diff PR-gate decision point; it composes with every other
  // flag (--ci, --markdown, --json, --policy, --surface-dir).
  if (flagBool(args.flags, "changed")) {
    return scanChangedCommand(args, deps)
  }

  const policyPath = flagStr(args.flags, "policy")

  let policy: Policy
  try {
    policy = loadPolicyOrDefault(policyPath)
  } catch (err) {
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: EXIT.ERROR,
    }
  }

  // Resolve input source — an --online override (e.g. github config) wins.
  const input = deps.online?.inputOverride ?? resolveConfigInput(args, deps)
  if (isInputError(input)) {
    return { stdout: "", stderr: input.error, exitCode: input.exitCode }
  }
  const { text, configPath } = input

  return scanOneConfig(text, configPath, policy, args, deps)
}

/**
 * Scan one already-resolved config text and render it.  Shared by the default
 * single-config path and the `--changed` loop so both behave identically.
 */
function scanOneConfig(
  text: string,
  configPath: string,
  policy: Policy,
  args: ParsedArgs,
  deps: ScanDeps,
  allowReceipt = true,
): CommandResult {
  // Opt-in prompt-surface scan of local project documents (ADR 0015). Only reads
  // files when --surface-dir is given; default behaviour reads nothing but the
  // config. Bounded + offline (see readDocumentSurfaces).
  const surfaceDir = flagStr(args.flags, "surface-dir")
  const surfaces = surfaceDir
    ? readDocumentSurfaces(resolve(deps.cwd, surfaceDir))
    : undefined

  // Scan.
  let summary: ConfigSummaryReport
  try {
    summary = scanConfigText(text, configPath, {
      policy,
      now: deps.now,
      generatedAt: deps.generatedAt,
      extraFindings: deps.online?.extraFindings,
      surfaces,
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

  if (deps.writeCacheFile !== false) {
    try {
      writeCache(summary, join(deps.cwd, ".calllint", "last-scan.json"))
    } catch {
      // Cache is best-effort; never fail a scan because of it.
    }
  }

  // Render.
  const stdout = renderSummary(summary, args)

  // Receipt (new5 R3, ADR 0028). Opt-in via --receipt; written AFTER the report
  // exists, from the report (never a re-scan). Absent flag ⇒ behaviour is
  // byte-identical to before. A write failure fails the command (unlike the
  // best-effort cache), because the user explicitly asked for a receipt.
  // Skipped in the --changed loop (allowReceipt=false) to avoid N configs
  // clobbering one receipt file.
  if (allowReceipt && flagBool(args.flags, "receipt")) {
    const err = writeReceiptFile(summary, text, configPath, policy, args, deps)
    if (err) return { stdout: "", stderr: err, exitCode: EXIT.ERROR }
  }

  // Exit code: only fail the process under --ci.
  const exitCode = flagBool(args.flags, "ci") ? exitCodeFor(summary, policy) : EXIT.OK
  return { stdout, exitCode }
}

/**
 * Write a `calllint.receipt.v0` for a completed scan. Returns an error string on
 * failure (so the caller fails the command), or undefined on success. Pure
 * reporting layer: derives everything from `summary`, runs no risk logic, makes
 * no network call, reads no secret values. `input_hash` is over the raw config
 * text (the normalized parser form is not cleanly reachable here — documented in
 * RECEIPTS.md); `ruleset_hash` is over the tool identity (detectors are
 * pinned to the CLI version; there is no separate detector-version registry).
 */
function writeReceiptFile(
  summary: ConfigSummaryReport,
  text: string,
  configPath: string,
  policy: Policy,
  args: ParsedArgs,
  deps: ScanDeps,
): string | undefined {
  const toolVersion = deps.toolVersion ?? "0.0.0-dev"
  const receipt = createReceipt(
    {
      toolVersion,
      subject: { type: "scan", target: configPath },
      inputForHash: text,
      effectivePolicyForHash: policy ?? { policy: "default" },
      scanReport: summary,
      rulesetForHash: { tool: "calllint", version: toolVersion },
      networkUsed: flagBool(args.flags, "online"),
    },
    deps.generatedAt,
  )

  const outPath = resolve(
    deps.cwd,
    flagStr(args.flags, "receipt-out") ?? "calllint-receipt.json",
  )
  try {
    writeFileSync(outPath, JSON.stringify(receipt, null, 2) + "\n", "utf8")
  } catch (e) {
    return `Could not write receipt to ${outPath}: ${e instanceof Error ? e.message : String(e)}`
  }
  return undefined
}

/** Render one summary in the format selected by the flags. */
function renderSummary(summary: ConfigSummaryReport, args: ParsedArgs): string {
  const style = flagBool(args.flags, "no-emoji") ? NO_EMOJI_STYLE : DEFAULT_STYLE
  if (flagBool(args.flags, "json")) return renderJson(summary)
  if (flagBool(args.flags, "sarif")) return renderSarif(summary)
  if (flagBool(args.flags, "markdown")) return renderMarkdown(summary)
  if (flagBool(args.flags, "badge")) return renderBadge(summary)
  if (flagBool(args.flags, "html")) return renderHtml(summary)
  if (flagBool(args.flags, "compact")) return renderCompact(summary, style)
  return renderTerminal(summary, style)
}

/**
 * `scan --changed` — scan only the agent-tool configs that changed in the git
 * diff.  No-op (exit 0) when nothing relevant changed.  One changed config
 * behaves exactly like `scan <path>`.  For N > 1, outputs are aggregated:
 * `--json` emits a JSON array of unchanged `calllint.report.v0` summaries;
 * other formats are concatenated with a `---` separator.  The process exit
 * code is the worst (highest) child exit code under `--ci`.
 */
function scanChangedCommand(args: ParsedArgs, deps: ScanDeps): CommandResult {
  const policyPath = flagStr(args.flags, "policy")
  let policy: Policy
  try {
    policy = loadPolicyOrDefault(policyPath)
  } catch (err) {
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: EXIT.ERROR,
    }
  }

  if (!deps.getChangedFilesDiff) {
    return {
      stdout: "",
      stderr:
        "--changed needs a git diff source. Run inside a git repository, or scan a path directly.",
      exitCode: EXIT.USAGE,
    }
  }

  const paths = changedConfigPaths(deps.cwd, deps.getChangedFilesDiff)
  if (paths.length === 0) {
    return {
      stdout: "No agent-tool configs changed in the git diff. Nothing to scan.",
      exitCode: EXIT.OK,
    }
  }

  const results = paths.map((p) => {
    const text = readFileSync(p, "utf8")
    return scanOneConfig(text, p, policy, args, deps)
  })

  // Exit code = worst child code (BLOCK 30 > UNKNOWN 20 > REVIEW 10 > OK 0).
  const exitCode = results.reduce<number>((worst, r) => Math.max(worst, r.exitCode), EXIT.OK)

  // Aggregate output. `--json` always emits a JSON array (one element per
  // changed config) so machine consumers get a stable shape regardless of N;
  // each element is an unchanged single-config `calllint.report.v0`. Other
  // formats are human/CI text → concatenate with a separator.
  let stdout: string
  if (flagBool(args.flags, "json")) {
    stdout = "[" + results.map((r) => r.stdout).join(",\n") + "]"
  } else {
    stdout = results.map((r) => r.stdout).join("\n\n---\n\n")
  }

  const stderr = results
    .map((r) => r.stderr)
    .filter(Boolean)
    .join("\n")

  return { stdout, exitCode, ...(stderr ? { stderr } : {}) }
}
