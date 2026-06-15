import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  scanConfigText,
  writeCache,
  ConfigParseError,
} from "@mcpguard/core"
import { loadPolicyOrDefault } from "@mcpguard/policy"
import {
  renderJson,
  renderTerminal,
  renderCompact,
  NO_EMOJI_STYLE,
  DEFAULT_STYLE,
} from "@mcpguard/report-renderer"
import type { Policy } from "@mcpguard/types"
import { EXIT, flagBool, flagStr, type ParsedArgs } from "../args.js"
import { exitCodeFor } from "../exitCode.js"

export interface CommandResult {
  stdout: string
  stderr?: string
  exitCode: number
}

/** Common locations to probe when no path is given. */
const DEFAULT_CONFIG_PATHS = [
  ".cursor/mcp.json",
  ".mcp.json",
  "mcp.json",
  ".claude/settings.json",
  ".vscode/mcp.json",
]

export interface ScanDeps {
  cwd: string
  readStdin: () => string
  now: number
  generatedAt: string
  /** When false, skip writing the cache (used in tests). */
  writeCacheFile?: boolean
}

function findDefaultConfig(cwd: string): string | undefined {
  for (const rel of DEFAULT_CONFIG_PATHS) {
    const p = join(cwd, rel)
    if (existsSync(p)) return p
  }
  return undefined
}

export function scanCommand(args: ParsedArgs, deps: ScanDeps): CommandResult {
  const useStdin = flagBool(args.flags, "stdin")
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

  // Resolve input source.
  let text: string
  let configPath: string
  if (useStdin) {
    text = deps.readStdin()
    configPath = "<stdin>"
  } else {
    const given = args.positionals[0]
    const resolved = given ?? findDefaultConfig(deps.cwd)
    if (!resolved) {
      return {
        stdout: "",
        stderr:
          "No config given and none found. Pass a path or use --stdin.\nLooked in: " +
          DEFAULT_CONFIG_PATHS.join(", "),
        exitCode: EXIT.USAGE,
      }
    }
    if (!existsSync(resolved)) {
      return { stdout: "", stderr: `File not found: ${resolved}`, exitCode: EXIT.USAGE }
    }
    text = readFileSync(resolved, "utf8")
    configPath = resolved
  }

  // Scan.
  let summary
  try {
    summary = scanConfigText(text, configPath, {
      policy,
      now: deps.now,
      generatedAt: deps.generatedAt,
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
      writeCache(summary, join(deps.cwd, ".mcpguard", "last-scan.json"))
    } catch {
      // Cache is best-effort; never fail a scan because of it.
    }
  }

  // Render.
  const style = flagBool(args.flags, "no-emoji") ? NO_EMOJI_STYLE : DEFAULT_STYLE
  let stdout: string
  if (flagBool(args.flags, "json")) stdout = renderJson(summary)
  else if (flagBool(args.flags, "compact")) stdout = renderCompact(summary, style)
  else stdout = renderTerminal(summary, style)

  // Exit code: only fail the process under --ci.
  const exitCode = flagBool(args.flags, "ci") ? exitCodeFor(summary, policy) : EXIT.OK
  return { stdout, exitCode }
}
