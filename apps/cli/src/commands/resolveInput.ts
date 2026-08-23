import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseTargetSpec, synthesizeNpmConfig } from "@calllint/core"
import { EXIT, flagBool, type ParsedArgs } from "../args.js"

/** Common locations to probe when no path is given. */
export const DEFAULT_CONFIG_PATHS = [
  ".cursor/mcp.json",
  ".mcp.json",
  "mcp.json",
  ".claude/settings.json",
  ".vscode/mcp.json",
]

/**
 * Flags a user could reasonably expect to name the scan target, but which this CLI does not
 * have. Kept deliberately short: each entry must be a spelling somebody actually reached for,
 * not a guess at every synonym.
 *
 * `config` is deliberately NOT on this list any more: it is implemented, as an alias for the
 * positional target. See `resolveConfigInput`. Moving it off this list is the whole of that
 * change on the refusal side — the entry existed only while the flag was refused.
 *
 * This is not a list of forbidden flags — it is a list of flags whose presence, with no
 * positional target, means the user's path was swallowed. See the check in
 * `resolveConfigInput` for why that is silent rather than loud without this.
 */
export const TARGET_LOOKALIKE_FLAGS = ["file", "path", "target"] as const

/**
 * The flag that names the scan target. Read as an alias for the positional in
 * `resolveConfigInput`, which is where the reasoning for honouring it is recorded.
 *
 * Exported as a constant because HD-06 in `check-harness-distribution.mjs` subtracts
 * `TARGET_LOOKALIKE_FLAGS` from the set of flags the CLI reads, to stop a REFUSED flag from
 * counting as a supported one. `config` must be visible to that gate's source scan as a flag
 * that IS read — `args.flags[TARGET_FLAG]` is a subscript read, one of the four patterns HD-06
 * matches — so that an SSOT record advertising `--config` now passes truthfully instead of
 * being subtracted into invisibility.
 */
export const TARGET_FLAG = "config"

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

  /*
   * `--config <path>` names the scan target, exactly as the positional does.
   *
   * WHY IT IS READ HERE AND NOT GIVEN ITS OWN BRANCH. The flag resolves into `given` before
   * anything else looks at the target, so every downstream behaviour — npm:/github: spec
   * parsing, the existence check, the error strings, `configPath` in the report — is reached
   * by one code path for both spellings. A separate branch would be a second implementation
   * of "what is the target", and the two would drift; this is an alias, not a mechanism.
   *
   * WHY THE FLAG EXISTS AT ALL, given `calllint scan <path>` already worked. `--config` was
   * advertised on eight published surfaces and printed by `calllint inventory` for months
   * while no command read it. `parseArgs` consumes `--k v` as a flag/value pair, so the path
   * landed in `flags.config` and never became a positional. Both outcomes were wrong and the
   * dangerous one was silent (measured 2026-08-23):
   *
   *   no default config present → exit 2, "No config given and none found" — confusing, since
   *                               the user plainly did give one, but at least VISIBLE.
   *   a default config present  → the fallback below scanned `.cursor/mcp.json` instead and
   *                               exited 0 with a REVIEW verdict. The user asked about the
   *                               file they named and got an answer about a different one,
   *                               with nothing on stderr to say so.
   *
   * The second case is why this could not be left alone: a verdict that silently describes a
   * file nobody asked about is the "evidence must belong to the thing it claims" rule that
   * CallLint is built on, broken by CallLint. Two closures were available — retract the
   * published copy, or honour it. Honouring it costs one alias and introduces no new concept,
   * and it does not strand the users who already learned the flag from CallLint's own output.
   *
   * A positional wins if somehow both are given: it is the documented primary spelling, and
   * silently preferring the flag would reintroduce "scanned something other than what you
   * pointed at". `--config` with an empty value (`--config=`) is a usage error rather than a
   * fall-through to discovery, for the same reason.
   */
  const configFlag = args.flags[TARGET_FLAG]
  if (configFlag !== undefined && args.positionals.length === 0) {
    if (typeof configFlag !== "string" || configFlag.length === 0) {
      return {
        error: `--${TARGET_FLAG} needs a path: calllint scan --${TARGET_FLAG} <path>`,
        exitCode: EXIT.USAGE,
      }
    }
    args = { ...args, positionals: [configFlag] }
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

  // A flag that looks like it names the target, but that this CLI does not have.
  //
  // Without this branch the failure is silent in the dangerous direction: `parseArgs` consumes
  // `--k v` as a flag/value pair, so the path lands in `flags.<alias>` and never becomes a
  // positional. With a default config present, the fallback below would scan `.cursor/mcp.json`
  // and exit 0 — answering about a file the user never named, with nothing on stderr. That is
  // the same defect `--config` had; `--config` was fixed by implementing it, because CallLint
  // had published it. These three were never published, so the honest answer is to name the
  // real spelling rather than grow an alias per synonym.
  //
  // Deliberately narrow: it fires only when NO positional was given, so a correct invocation
  // that also happens to carry an unrelated flag is untouched.
  if (!given) {
    for (const alias of TARGET_LOOKALIKE_FLAGS) {
      const v = args.flags[alias]
      if (typeof v === "string") {
        return {
          error:
            `Unknown option --${alias}. The target is a positional argument:\n` +
            `  calllint scan ${v}\n` +
            "Use --stdin to read a config from standard input.",
          exitCode: EXIT.USAGE,
        }
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
