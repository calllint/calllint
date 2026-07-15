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
  renderTrustPacket,
  NO_EMOJI_STYLE,
  DEFAULT_STYLE,
} from "@calllint/report-renderer"
import type { GatewayEvidence, Policy } from "@calllint/types"
import { importEvidence, type EvidenceFormat } from "@calllint/evidence"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import { exitCodeFor } from "../exitCode.js"
import { resolveConfigInput, isInputError } from "./resolveInput.js"
import { changedConfigPaths } from "./changedConfigs.js"
import { readDocumentSurfaces } from "./surfaces.js"
import type { OnlineEnrichment } from "../run.js"
import { readFileSync, writeFileSync } from "node:fs"
import type { ConfigSummaryReport } from "@calllint/types"
import { discoverConfigs, discoverAgent, type AgentType } from "@calllint/discovery"

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

  // `--auto` discovers and scans all agent configs (Stream 1 Stage 3)
  if (flagBool(args.flags, "auto")) {
    return scanAutoCommand(args, deps)
  }

  // `--agent <type>` discovers and scans a specific agent type (Stream 1 Stage 3)
  const agentType = flagStr(args.flags, "agent")
  if (agentType) {
    return scanAgentCommand(agentType, args, deps)
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

  // Opt-in external scanner evidence (`--evidence <file>`, ADR 0034). Read at the
  // edge and imported here (pure, fail-closed); attached to the report as a
  // supporting projection, NEVER fed into the verdict. Absent flag ⇒ output is
  // byte-identical to today. A missing/unparseable report cannot pass silently:
  // a not-found file is a usage error, a bad report imports as completeness:failed.
  const evidenceFile = flagStr(args.flags, "evidence")
  let evidence: GatewayEvidence[] | undefined
  if (evidenceFile) {
    const loaded = loadEvidence(evidenceFile, args, deps)
    if ("error" in loaded) {
      return { stdout: "", stderr: loaded.error, exitCode: loaded.exitCode }
    }
    evidence = [loaded]
  }

  // Scan.
  let summary: ConfigSummaryReport
  try {
    summary = scanConfigText(text, configPath, {
      policy,
      now: deps.now,
      generatedAt: deps.generatedAt,
      extraFindings: deps.online?.extraFindings,
      surfaces,
      evidence,
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
  const stdout = renderSummary(summary, args, deps.toolVersion)

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

/**
 * Import an external evidence file at the CLI edge (I/O here; `importEvidence`
 * is pure and fail-closed). Mirrors the `trust prepare` helper: a missing file
 * is a usage error, but an unparseable report never throws — it imports as a
 * `completeness:"failed"` envelope so it can only be surfaced as "not a pass",
 * never silently dropped (ADR 0034). Provider/format auto-detect; `--evidence-format`
 * forces the format when auto-detection is ambiguous.
 */
function loadEvidence(
  file: string,
  args: ParsedArgs,
  deps: ScanDeps,
): GatewayEvidence | { error: string; exitCode: number } {
  let rawText: string
  try {
    rawText = readFileSync(resolve(deps.cwd, file), "utf8")
  } catch (err) {
    const e = err as Error & { code?: string }
    return {
      error: e.code === "ENOENT" ? `Evidence file not found: ${file}` : e.message,
      exitCode: EXIT.USAGE,
    }
  }
  const fmt = flagStr(args.flags, "evidence-format")
  const format: EvidenceFormat | undefined =
    fmt === "sarif" ? "sarif" : fmt === "json" ? "json" : undefined
  return importEvidence(rawText, { format }) as GatewayEvidence
}

/**
 * Render one summary in the format selected by the flags. When external
 * evidence is attached (`--evidence`), the human-readable paths append the joint
 * Trust Packet (Content scan vs Authority scan, unmerged + why they differ). The
 * machine formats (`--json`/`--sarif`) already carry the evidence in the report
 * projection, so they are left unchanged.
 */
function renderSummary(
  summary: ConfigSummaryReport,
  args: ParsedArgs,
  toolVersion?: string,
): string {
  const style = flagBool(args.flags, "no-emoji") ? NO_EMOJI_STYLE : DEFAULT_STYLE
  if (flagBool(args.flags, "json")) return renderJson(summary)
  if (flagBool(args.flags, "sarif")) return renderSarif(summary)
  if (flagBool(args.flags, "markdown")) return renderMarkdown(summary)
  if (flagBool(args.flags, "badge")) return renderBadge(summary)
  if (flagBool(args.flags, "html")) return renderHtml(summary)
  const base = flagBool(args.flags, "compact")
    ? renderCompact(summary, style)
    : renderTerminal(summary, style)
  const packet = renderTrustPacket(summary, toolVersion ?? "0.0.0-dev", style)
  return packet ? base + "\n" + packet : base
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

/**
 * `scan --auto` — discover all agent configs and scan them.
 *
 * Discovers configs from all registered agents (P0: Cursor, Claude Code, Claude Desktop).
 * Scans each discovered config and aggregates results.
 * Exit code is the worst (highest) child exit code.
 */
function scanAutoCommand(args: ParsedArgs, deps: ScanDeps): CommandResult {
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

  // Discover all agent configs (synchronous now)
  const discovered = discoverConfigs({ cwd: deps.cwd })

  if (discovered.discovered.length === 0) {
    return {
      stdout: "",
      stderr: "No agent configs discovered. Try: calllint inventory\n",
      exitCode: EXIT.ERROR,
    }
  }

  // Scan each discovered config
  const results: CommandResult[] = []
  for (const config of discovered.discovered) {
    let text: string
    try {
      text = readFileSync(config.configPath, "utf8")
    } catch (err) {
      results.push({
        stdout: "",
        stderr: `Could not read ${config.configPath}: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: EXIT.ERROR,
      })
      continue
    }

    const result = scanOneConfig(text, config.configPath, policy, args, deps, false)
    results.push(result)
  }

  // Aggregate results
  const isJson = flagBool(args.flags, "json")
  const stdout = isJson
    ? JSON.stringify(results.map((r) => JSON.parse(r.stdout)), null, 2) + "\n"
    : results.map((r) => r.stdout).join("\n---\n\n")

  const exitCode = flagBool(args.flags, "ci")
    ? Math.max(...results.map((r) => r.exitCode))
    : EXIT.OK

  const stderr = results
    .map((r) => r.stderr)
    .filter(Boolean)
    .join("\n")

  return { stdout, exitCode, ...(stderr ? { stderr } : {}) }
}

/**
 * `scan --agent <type>` — discover and scan a specific agent type.
 *
 * Discovers configs for the specified agent type only.
 * Scans each discovered config and aggregates results (typically one).
 * Exit code is the worst (highest) child exit code.
 */
function scanAgentCommand(
  agentType: string,
  args: ParsedArgs,
  deps: ScanDeps,
): CommandResult {
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

  // Discover configs for the specified agent type (synchronous now)
  const discovered = discoverAgent(agentType as AgentType, { cwd: deps.cwd })

  // Filter to only existing configs
  const existing = discovered.filter(c => c.exists)

  if (existing.length === 0) {
    return {
      stdout: "",
      stderr: `No config found for agent '${agentType}'. Try: calllint inventory\n`,
      exitCode: EXIT.ERROR,
    }
  }

  // Scan each discovered config (typically one per agent type)
  const results: CommandResult[] = []
  for (const config of existing) {
    let text: string
    try {
      text = readFileSync(config.configPath, "utf8")
    } catch (err) {
      results.push({
        stdout: "",
        stderr: `Could not read ${config.configPath}: ${err instanceof Error ? err.message : String(err)}`,
        exitCode: EXIT.ERROR,
      })
      continue
    }

    const result = scanOneConfig(text, config.configPath, policy, args, deps, true)
    results.push(result)
  }

  // Aggregate results (typically just one)
  if (results.length === 1) {
    return results[0]!
  }

  const isJson = flagBool(args.flags, "json")
  const stdout = isJson
    ? JSON.stringify(results.map((r) => JSON.parse(r.stdout)), null, 2) + "\n"
    : results.map((r) => r.stdout).join("\n---\n\n")

  const exitCode = flagBool(args.flags, "ci")
    ? Math.max(...results.map((r) => r.exitCode))
    : EXIT.OK

  const stderr = results
    .map((r) => r.stderr)
    .filter(Boolean)
    .join("\n")

  return { stdout, exitCode, ...(stderr ? { stderr } : {}) }
}
