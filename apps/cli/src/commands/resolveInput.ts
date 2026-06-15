import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseTargetSpec, synthesizeNpmConfig } from "@mcpguard/core"
import { EXIT, flagBool, type ParsedArgs } from "../args.js"

/** Common locations to probe when no path is given. */
export const DEFAULT_CONFIG_PATHS = [
  ".cursor/mcp.json",
  ".mcp.json",
  "mcp.json",
  ".claude/settings.json",
  ".vscode/mcp.json",
]

export function findDefaultConfig(cwd: string): string | undefined {
  for (const rel of DEFAULT_CONFIG_PATHS) {
    const p = join(cwd, rel)
    if (existsSync(p)) return p
  }
  return undefined
}

export interface ResolvedInput {
  text: string
  configPath: string
}

export interface InputError {
  error: string
  exitCode: number
}

export function isInputError(v: ResolvedInput | InputError): v is InputError {
  return "error" in v
}

/**
 * Resolve config input from --stdin, an explicit positional path, or default
 * discovery. Shared by scan / baseline / verify so they behave identically.
 */
export function resolveConfigInput(
  args: ParsedArgs,
  deps: { cwd: string; readStdin: () => string },
): ResolvedInput | InputError {
  if (flagBool(args.flags, "stdin")) {
    return { text: deps.readStdin(), configPath: "<stdin>" }
  }
  const given = args.positionals[0]

  // npm: / github: synthetic targets (offline). Network enrichment is opt-in
  // via --online and handled by the caller before reaching here.
  if (given) {
    const spec = parseTargetSpec(given)
    if (spec.kind === "npm") {
      if (!spec.packageSpec) {
        return { error: "Empty npm target. Use npm:<package>[@version].", exitCode: EXIT.USAGE }
      }
      return synthesizeNpmConfig(spec.packageSpec)
    }
    if (spec.kind === "github") {
      return {
        error:
          "GitHub targets require network access. Re-run with --online to fetch repo MCP configs.",
        exitCode: EXIT.USAGE,
      }
    }
  }

  const resolved = given ?? findDefaultConfig(deps.cwd)
  if (!resolved) {
    return {
      error:
        "No config given and none found. Pass a path or use --stdin.\nLooked in: " +
        DEFAULT_CONFIG_PATHS.join(", "),
      exitCode: EXIT.USAGE,
    }
  }
  if (!existsSync(resolved)) {
    return { error: `File not found: ${resolved}`, exitCode: EXIT.USAGE }
  }
  return { text: readFileSync(resolved, "utf8"), configPath: resolved }
}
