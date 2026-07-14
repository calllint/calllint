/**
 * Cross-platform path safety for the apply edge (ADR 0037). The engine takes
 * ONLY absolute, home-expanded paths; these helpers turn an adapter's
 * "~/.claude.json" into a concrete absolute path and reject the shapes that make
 * config-writing dangerous.
 *
 * The rules are OS-agnostic on purpose: a NUL byte, an unexpanded "~" mid-path,
 * or a non-absolute result is refused everywhere so a plan authored on one OS
 * can't smuggle a surprising write target on another.
 */
import { isAbsolute, resolve } from "node:path"

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PathSafetyError"
  }
}

/**
 * Expand a leading "~" (and "~/") to the given home dir, then resolve to an
 * absolute path. A "~" anywhere but the first segment is rejected (a real path
 * segment named "~" is vanishingly rare and far more likely to be a mistake or
 * an attempt to confuse expansion).
 */
export function expandHome(p: string, home: string): string {
  if (p.includes("\0")) throw new PathSafetyError("path contains a NUL byte")
  let expanded = p
  if (p === "~") expanded = home
  else if (p.startsWith("~/") || p.startsWith("~\\")) expanded = home + p.slice(1)
  else if (p.startsWith("~")) throw new PathSafetyError(`refusing to expand "~" username form: ${p}`)
  return expanded
}

/**
 * Resolve an adapter config path to a safe absolute path against `cwd`+`home`.
 * Throws PathSafetyError on anything the engine must not be handed.
 */
export function safeConfigPath(rawPath: string, opts: { cwd: string; home: string }): string {
  const expanded = expandHome(rawPath, opts.home)
  const abs = isAbsolute(expanded) ? expanded : resolve(opts.cwd, expanded)
  if (abs.includes("\0")) throw new PathSafetyError("resolved path contains a NUL byte")
  if (!isAbsolute(abs)) throw new PathSafetyError(`could not resolve to an absolute path: ${rawPath}`)
  return abs
}
