import { join, resolve } from "node:path"
import {
  scanConfigText,
  writeCache,
  ConfigParseError,
} from "@calllint/core"
import { loadPolicyOrDefault } from "@calllint/policy"
import {
  renderJson,
  renderTerminal,
  renderCompact,
  renderSarif,
  renderHtml,
  NO_EMOJI_STYLE,
  DEFAULT_STYLE,
} from "@calllint/report-renderer"
import type { Policy } from "@calllint/types"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import { exitCodeFor } from "../exitCode.js"
import { resolveConfigInput, isInputError } from "./resolveInput.js"
import { readDocumentSurfaces } from "./surfaces.js"
import type { OnlineEnrichment } from "../run.js"

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
}

export function scanCommand(args: ParsedArgs, deps: ScanDeps): CommandResult {
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

  // Opt-in prompt-surface scan of local project documents (ADR 0015). Only reads
  // files when --surface-dir is given; default behaviour reads nothing but the
  // config. Bounded + offline (see readDocumentSurfaces).
  const surfaceDir = flagStr(args.flags, "surface-dir")
  const surfaces = surfaceDir
    ? readDocumentSurfaces(resolve(deps.cwd, surfaceDir))
    : undefined

  // Scan.
  let summary
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
  const style = flagBool(args.flags, "no-emoji") ? NO_EMOJI_STYLE : DEFAULT_STYLE
  let stdout: string
  if (flagBool(args.flags, "json")) stdout = renderJson(summary)
  else if (flagBool(args.flags, "sarif")) stdout = renderSarif(summary)
  else if (flagBool(args.flags, "html")) stdout = renderHtml(summary)
  else if (flagBool(args.flags, "compact")) stdout = renderCompact(summary, style)
  else stdout = renderTerminal(summary, style)

  // Exit code: only fail the process under --ci.
  const exitCode = flagBool(args.flags, "ci") ? exitCodeFor(summary, policy) : EXIT.OK
  return { stdout, exitCode }
}
